import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { Admin, adminSummary } from '../models/Admin.js';
import { AdminSession } from '../models/AdminSession.js';
import { adminService } from '../services/adminService.js';
import { adminCookie, adminCookieOptions, adminSessionDuration, adminRequestGuard, authenticateAdmin, hashAdminToken, readAdminToken } from '../middleware/authenticateAdmin.js';
import { createLimiter } from '../middleware/rateLimiters.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import adminRecipeRoutes from './adminRecipeRoutes.js';
import adminEventRoutes from './adminEventRoutes.js';

const router = Router();
const ok = (res, data) => res.json({ success: true, data });
const loginLimiter = createLimiter('admin-login', { windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true });
let dummyHash;
router.use(adminRequestGuard);
router.post('/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  const input = z.object({ email: z.email().max(254).transform(value => value.trim().toLowerCase()), password: z.string().min(1).max(256) }).strict().parse(req.body);
  const admin = await Admin.findOne({ email: input.email }).select('+passwordHash');
  dummyHash ||= argon2.hash(randomBytes(32).toString('hex'));
  const valid = await argon2.verify(admin?.passwordHash || await dummyHash, input.password);
  if (!valid || !admin || admin.status !== 'active') throw new AppError(401, 'ADMIN_INVALID_CREDENTIALS', 'Email ou palavra-passe inválidos.');
  const previous = readAdminToken(req);
  if (previous) await AdminSession.deleteOne({ tokenHash: hashAdminToken(previous) });
  const token = randomBytes(32).toString('hex');
  await AdminSession.create({ admin: admin._id, tokenHash: hashAdminToken(token), expiresAt: new Date(Date.now() + adminSessionDuration) });
  await Admin.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });
  res.cookie(adminCookie, token, { ...adminCookieOptions, maxAge: adminSessionDuration });
  ok(res, { admin: adminSummary(admin) });
}));
router.post('/auth/logout', asyncHandler(async (req, res) => {
  const token = readAdminToken(req);
  if (token) await AdminSession.deleteOne({ tokenHash: hashAdminToken(token) });
  res.clearCookie(adminCookie, adminCookieOptions);
  ok(res, null);
}));
router.use(authenticateAdmin);
router.use('/recipes', adminRecipeRoutes);
router.use('/events', adminEventRoutes);
router.get('/auth/me', (req, res) => ok(res, { admin: adminSummary(req.admin) }));
router.get('/dashboard', asyncHandler(async (req, res) => ok(res, await adminService.dashboard(req.query))));
router.get('/products', asyncHandler(async (req, res) => ok(res, await adminService.products(req.query))));
router.patch('/products/:id', asyncHandler(async (req, res) => ok(res, await adminService.updateProduct(req.params.id, req.body))));
router.get('/users', asyncHandler(async (req, res) => ok(res, await adminService.users(req.query))));
router.patch('/users/:id/status', asyncHandler(async (req, res) => ok(res, await adminService.updateUserStatus(req.params.id, req.body))));
router.get('/categories', asyncHandler(async (_req, res) => ok(res, await adminService.categories())));
router.get('/transactions', asyncHandler(async (req, res) => ok(res, await adminService.transactions(req.query))));
router.get('/reports/export', asyncHandler(async (req, res) => {
  const data = await adminService.dashboard(req.query);
  const rows = ['Data;Anúncios criados;Novos utilizadores;Transações concluídas;Valor acordado (EUR)', ...data.activity.map(row =>
    [row.date, row.products, row.users, row.transactions, row.revenue.toFixed(2).replace('.', ',')].join(';'))];
  res.type('text/csv; charset=utf-8').attachment(`figo-relatorio-${data.range.from}-${data.range.to}.csv`).send('\uFEFF' + rows.join('\r\n'));
}));
export default router;
