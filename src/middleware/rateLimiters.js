import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { tokenService } from '../services/tokenService.js';

const logSalt = randomBytes(32);
const fingerprint = value => createHmac('sha256', logSalt).update(String(value)).digest('hex').slice(0, 16);
const response = { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados pedidos. Tenta novamente mais tarde.' } };

// Signed identity is used only for accounting. Route authentication still validates
// the account and session. Never trust a decoded token or a client-provided user ID.
export function clientKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = tokenService.verifyAccessToken(token);
      if (typeof payload.sub === 'string') return `user:${payload.sub}`;
    } catch { /* Anonymous/expired tokens share the IP protection. */ }
  }
  return `ip:${ipKeyGenerator(req.ip || req.socket.remoteAddress)}`;
}

export function createLimiter(name, options) {
  return rateLimit({
    standardHeaders: 'draft-8', legacyHeaders: false, message: response,
    ...options,
    handler(req, res, _next, config) {
      const retryAfterSeconds = Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000));
      console.warn('RATE_LIMIT_BLOCKED', {
        limiter: name, method: req.method,
        route: req.route ? `${req.baseUrl}${req.route.path}` : req.path.replace(/[a-f0-9]{24}/gi, ':id'),
        client: fingerprint(clientKey(req)), ip: fingerprint(req.ip),
        limit: req.rateLimit.limit, windowMs: config.windowMs, retryAfterSeconds
      });
      res.status(429).set('Retry-After', String(retryAfterSeconds)).json({
        ...config.message, retryAfterSeconds
      });
    }
  });
}

export const globalLimiter = createLimiter('api', {
  windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MS, limit: env.GLOBAL_RATE_LIMIT_MAX,
  keyGenerator: clientKey,
  skip: req => req.path === '/api/v1/conversations' || req.path.startsWith('/api/v1/conversations/')
});
// Each sensitive operation gets its own bucket, so login never consumes the
// verification or password-reset budget. Successful logins do not count as failures.
export const authLimiter = createLimiter('auth-operation', {
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS, limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: req => `${clientKey(req)}:${req.path}`,
  skipSuccessfulRequests: true
});
export const refreshLimiter = createLimiter('session-refresh', {
  windowMs: 60000, limit: env.REFRESH_RATE_LIMIT_MAX,
  keyGenerator(req) {
    try {
      const payload = tokenService.verifyRefreshToken(req.body?.refreshToken);
      return `user:${payload.sub}`;
    } catch { return clientKey(req); }
  }
});
export const verificationSendLimiter = createLimiter('verification-send', {
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS, limit: env.VERIFICATION_RATE_LIMIT_MAX,
  keyGenerator: clientKey
});
export const forgotPasswordLimiter = createLimiter('forgot-password', {
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS, limit: env.FORGOT_PASSWORD_RATE_LIMIT_MAX
});
