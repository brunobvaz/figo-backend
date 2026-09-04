import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { tokenService } from '../services/tokenService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'AUTH_TOKEN_REQUIRED', 'É necessário um access token.');
  let payload;
  try { payload = tokenService.verifyAccessToken(token); }
  catch (error) {
    const code = error.name === 'TokenExpiredError' ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID';
    throw new AppError(401, code, 'Access token inválido ou expirado.');
  }
  const [user, session] = await Promise.all([User.findById(payload.sub), Session.findById(payload.sid)]);
  if (!user) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Access token inválido ou expirado.');
  if (user.status === 'suspended') throw new AppError(403, 'USER_SUSPENDED', 'A conta encontra-se suspensa.');
  if (user.status !== 'active') throw new AppError(403, 'USER_INACTIVE', 'A conta não está ativa.');
  if (!session || session.revokedAt || session.userId.toString() !== user.id) throw new AppError(401, 'AUTH_SESSION_INVALID', 'A sessão já não é válida.');
  req.user = user;
  req.auth = { sessionId: session.id, token: payload };
  next();
});
