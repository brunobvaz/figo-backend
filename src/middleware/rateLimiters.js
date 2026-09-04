import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const response = { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados pedidos. Tenta novamente mais tarde.' } };
const base = { standardHeaders: 'draft-8', legacyHeaders: false, message: response };

export const globalLimiter = rateLimit({ ...base, windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MS, limit: env.GLOBAL_RATE_LIMIT_MAX });
export const authLimiter = rateLimit({ ...base, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS, limit: env.AUTH_RATE_LIMIT_MAX });
export const forgotPasswordLimiter = rateLimit({ ...base, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS, limit: env.FORGOT_PASSWORD_RATE_LIMIT_MAX });
