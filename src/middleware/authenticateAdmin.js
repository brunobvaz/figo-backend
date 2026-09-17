import { createHash } from 'node:crypto';
import { Admin } from '../models/Admin.js';
import { AdminSession } from '../models/AdminSession.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const adminCookie = 'figo_admin';
export const adminSessionDuration = 12 * 60 * 60 * 1000;
export const hashAdminToken = token => createHash('sha256').update(token).digest('hex');
export const adminCookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/admin' };
export const readAdminToken = req => (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${adminCookie}=`))?.slice(adminCookie.length + 1);

// A custom header requires a browser preflight. Combined with an exact origin
// allowlist and SameSite cookies, forms and third-party sites cannot mutate data.
export function adminRequestGuard(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const allowedOrigins = env.BACKOFFICE_ORIGIN.split(',').map(value => value.trim());
  if (req.get('X-Figo-Backoffice') !== '1' || (req.get('Origin') && !allowedOrigins.includes(req.get('Origin')))) {
    return next(new AppError(403, 'ADMIN_ORIGIN_FORBIDDEN', 'Pedido de administração não autorizado.'));
  }
  next();
}

export const authenticateAdmin = asyncHandler(async (req, _res, next) => {
  const token = readAdminToken(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(401, 'ADMIN_SESSION_REQUIRED', 'Inicia sessão com uma conta de administrador.');
  const session = await AdminSession.findOne({ tokenHash: hashAdminToken(token), expiresAt: { $gt: new Date() } });
  const admin = session && await Admin.findOne({ _id: session.admin, status: 'active' });
  if (!admin) throw new AppError(401, 'ADMIN_SESSION_INVALID', 'A sessão expirou ou o acesso foi revogado.');
  req.admin = admin;
  req.adminSession = session;
  next();
});
