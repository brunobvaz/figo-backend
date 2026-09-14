import { resolveUserLocation } from './locationService.js';
import { PushDevice } from '../models/PushDevice.js';
import argon2 from 'argon2';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { OneTimeToken } from '../models/OneTimeToken.js';
import { EmailOtp } from '../models/EmailOtp.js';
import { AppError } from '../utils/AppError.js';
import { createOpaqueToken, createOtp, hashOtp, hashToken, safeEqual } from '../utils/crypto.js';
import { normalizeEmail, normalizePhone } from '../utils/normalizers.js';
import { env } from '../config/env.js';
import { tokenService } from './tokenService.js';
import { emailService } from './emailService.js';

const publicUser = (user) => ({
  id: user.id, name: user.name, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, avatarFilename: user.avatarFilename,
  location: user.location, emailVerified: user.emailVerified, phoneVerified: user.phoneVerified,
  status: user.status, createdAt: user.createdAt
});

async function createSession(user, metadata) {
  const session = new Session({ userId: user._id, refreshTokenHash: 'pending', expiresAt: new Date(), ...metadata });
  const refreshToken = tokenService.generateRefreshToken(user, session.id);
  session.refreshTokenHash = hashToken(refreshToken);
  session.expiresAt = tokenService.expirationDate(refreshToken);
  await session.save();
  return { accessToken: tokenService.generateAccessToken(user, session.id), refreshToken };
}

async function createOneTimeToken(user, type, minutes) {
  const token = createOpaqueToken();
  const record = await OneTimeToken.create({ userId: user._id, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + minutes * 60_000) });
  return { token, record };
}

async function createEmailOtp(user) {
  const challenge = new EmailOtp({ userId: user._id, codeHash: 'pending', expiresAt: new Date(Date.now() + env.EMAIL_OTP_EXPIRES_IN_MINUTES * 60_000), lastSentAt: new Date() });
  const code = createOtp();
  challenge.codeHash = hashOtp(challenge.id, code, env.EMAIL_OTP_SECRET);
  await challenge.save();
  // Explicit bench-only diagnostic requested for OTP delivery troubleshooting.
  if (env.MONGODB_DB_NAME === 'bench') console.info('[OTP][bench] Código gerado', { email: user.email, code });
  try { await emailService.sendEmailVerification(user.email, code); }
  catch (error) { await EmailOtp.deleteOne({ _id: challenge._id }); throw error; }
  // Keep the previous challenge usable if delivery fails.
  await EmailOtp.deleteMany({ userId: user._id, usedAt: null, _id: { $lt: challenge._id } });
  return {
    challengeId: challenge.id,
    email: user.email,
    expiresInSeconds: env.EMAIL_OTP_EXPIRES_IN_MINUTES * 60,
    resendAfterSeconds: env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    ...(env.NODE_ENV === 'development' ? { devCode: code } : {})
  };
}

export const authService = {
  async register(input) {
    const email = normalizeEmail(input.email);
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    const location = await resolveUserLocation(input.location);
    const name = `${input.firstName} ${input.lastName}`.trim();
    const [existingUser, phoneOwner] = await Promise.all([User.findOne({ email }).select('+passwordHash'), phone ? User.findOne({ phone }) : null]);
    if (existingUser?.emailVerified || (existingUser && existingUser.status !== 'active')) throw new AppError(409, 'USER_EMAIL_EXISTS', 'Já existe uma conta com este email.');
    if (phoneOwner && phoneOwner.id !== existingUser?.id) throw new AppError(409, 'USER_PHONE_EXISTS', 'Já existe uma conta com este telefone.');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    let user;
    if (existingUser) {
      Object.assign(existingUser, {
        name, firstName: input.firstName, lastName: input.lastName, ...(phone ? { phone } : {}), passwordHash,
        usageIntent: input.usageIntent,
        location, termsAcceptedAt: new Date(), ageConfirmedAt: new Date(),
        marketingConsent: input.marketingConsent,
        marketingConsentAt: input.marketingConsent ? new Date() : null
      });
      user = await existingUser.save();
    } else {
      user = await User.create({
        ...input, name, email, phone, passwordHash, location, termsAcceptedAt: new Date(), ageConfirmedAt: new Date(),
        marketingConsentAt: input.marketingConsent ? new Date() : null
      });
    }
    return { user: publicUser(user), verification: await createEmailOtp(user) };
  },

  async login({ email, password }, metadata) {
    const user = await User.findOne({ email: normalizeEmail(email) }).select('+passwordHash');
    const valid = user ? await argon2.verify(user.passwordHash, password) : false;
    if (!user || !valid) throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email ou palavra-passe inválidos.');
    if (user.status === 'suspended') throw new AppError(403, 'USER_SUSPENDED', 'A conta encontra-se suspensa.');
    if (user.status !== 'active') throw new AppError(403, 'USER_INACTIVE', 'A conta não está ativa.');
    if (!user.emailVerified) {
      const verification = await createEmailOtp(user);
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Confirma o teu email antes de iniciar sessão.', verification);
    }
    user.lastLoginAt = new Date();
    await user.save();
    return { user: publicUser(user), ...(await createSession(user, metadata)) };
  },

  async refresh(refreshToken, metadata) {
    let payload;
    try { payload = tokenService.verifyRefreshToken(refreshToken); }
    catch { throw new AppError(401, 'AUTH_INVALID_REFRESH_TOKEN', 'Refresh token inválido ou expirado.'); }
    if (!mongoose.isValidObjectId(payload.sid)) throw new AppError(401, 'AUTH_INVALID_REFRESH_TOKEN', 'Refresh token inválido ou expirado.');
    const session = await Session.findById(payload.sid).select('+refreshTokenHash');
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId.toString() !== payload.sub || session.refreshTokenHash !== hashToken(refreshToken)) {
      if (session?.revokedAt || (session && session.refreshTokenHash !== hashToken(refreshToken))) await Session.updateMany({ userId: payload.sub, revokedAt: null }, { revokedAt: new Date() });
      throw new AppError(401, 'AUTH_INVALID_REFRESH_TOKEN', 'Refresh token inválido ou expirado.');
    }
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') throw new AppError(403, 'USER_INACTIVE', 'A conta não está ativa.');
    session.revokedAt = new Date();
    await session.save();
    const next = await createSession(user, metadata);
    const nextSession = tokenService.verifyAccessToken(next.accessToken).sid;
    await PushDevice.updateMany({ user: user.id, session: session.id }, { $set: { session: nextSession } });
    return next;
  },

  async logout(refreshToken) {
    try {
      const payload = tokenService.verifyRefreshToken(refreshToken);
      await Session.updateOne({ _id: payload.sid, userId: payload.sub, refreshTokenHash: hashToken(refreshToken) }, { revokedAt: new Date() });
    } catch { /* logout é idempotente */ }
  },

  async logoutAll(userId) { await Session.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() }); },
  getCurrentUser(user) { return publicUser(user); },

  async forgotPassword(email) {
    const user = await User.findOne({ email: normalizeEmail(email), status: 'active' });
    if (user) {
      const { token, record } = await createOneTimeToken(user, 'passwordReset', env.PASSWORD_RESET_EXPIRES_IN_MINUTES);
      try {
        await emailService.sendPasswordReset(user.email, token);
      } catch (error) {
        await OneTimeToken.deleteOne({ _id: record._id });
        if (error.code !== 'EMAIL_SEND_FAILED') throw error;
        // Preserve the generic public response, without logging addresses or tokens.
        console.error('[EmailService] Falha no envio de recuperação de password.');
        return;
      }
      await OneTimeToken.deleteMany({ userId: user._id, type: 'passwordReset', usedAt: null, _id: { $lt: record._id } });
    }
  },

  async resetPassword(token, newPassword) {
    const record = await OneTimeToken.findOne({ tokenHash: hashToken(token), type: 'passwordReset' }).select('+tokenHash');
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw new AppError(400, 'AUTH_INVALID_RESET_TOKEN', 'Token de recuperação inválido ou expirado.');
    const user = await User.findById(record.userId).select('+passwordHash');
    if (!user) throw new AppError(400, 'AUTH_INVALID_RESET_TOKEN', 'Token de recuperação inválido ou expirado.');
    user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    record.usedAt = new Date();
    await Promise.all([user.save(), record.save(), Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() })]);
  },

  async changePassword(userId, sessionId, currentPassword, newPassword) {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) throw new AppError(401, 'AUTH_INVALID_CURRENT_PASSWORD', 'A password atual está incorreta.');
    user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await Promise.all([user.save(), Session.updateMany({ userId, _id: { $ne: sessionId }, revokedAt: null }, { revokedAt: new Date() })]);
  },

  async sendEmailVerification(userId) {
    const user = await User.findById(userId);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');
    if (user.emailVerified) return { alreadyVerified: true };
    return createEmailOtp(user);
  },

  async resendEmailVerification(challengeId) {
    const current = await EmailOtp.findById(challengeId);
    if (!current || current.usedAt || current.expiresAt <= new Date()) throw new AppError(400, 'AUTH_INVALID_OTP_CHALLENGE', 'O pedido de verificação é inválido ou expirou.');
    const elapsed = Date.now() - current.lastSentAt.getTime();
    if (elapsed < env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000) throw new AppError(429, 'AUTH_OTP_RESEND_TOO_SOON', 'Aguarda antes de pedir um novo código.');
    const user = await User.findById(current.userId);
    if (!user || user.emailVerified) throw new AppError(400, 'AUTH_INVALID_OTP_CHALLENGE', 'O pedido de verificação é inválido ou expirou.');
    return createEmailOtp(user);
  },

  async verifyEmail({ challengeId, code }, metadata) {
    const record = await EmailOtp.findById(challengeId).select('+codeHash');
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw new AppError(400, 'AUTH_INVALID_OTP', 'Código inválido ou expirado.');
    if (record.attempts >= env.EMAIL_OTP_MAX_ATTEMPTS) throw new AppError(429, 'AUTH_OTP_ATTEMPTS_EXCEEDED', 'Foram excedidas as tentativas de verificação.');
    const candidate = hashOtp(record.id, code, env.EMAIL_OTP_SECRET);
    if (!safeEqual(record.codeHash, candidate)) {
      record.attempts += 1;
      await record.save();
      throw new AppError(400, 'AUTH_INVALID_OTP', 'Código inválido ou expirado.');
    }
    const user = await User.findById(record.userId);
    if (!user || user.status !== 'active') throw new AppError(403, 'USER_INACTIVE', 'A conta não está ativa.');
    record.usedAt = new Date();
    user.emailVerified = true;
    await Promise.all([record.save(), user.save()]);
    return { user: publicUser(user), ...(await createSession(user, metadata)) };
  }
};
