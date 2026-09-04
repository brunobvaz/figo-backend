import crypto from 'node:crypto';

export const createOpaqueToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const createOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
export const hashOtp = (challengeId, code, secret) => crypto.createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
export const safeEqual = (left, right) => {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
};
