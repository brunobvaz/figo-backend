import { Router } from 'express';
import { userController } from '../controllers/userController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { updateMeSchema } from '../validators/userValidators.js';
import { uploadAvatar } from '../middleware/avatarUpload.js';
import { transactionService } from '../services/transactionService.js';
import { userService } from '../services/userService.js';
import { z } from 'zod';

const router = Router();
router.get('/me/reputation', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await transactionService.reputation(req.user.id) })));
router.get('/me/commerce', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await transactionService.summary(req.user.id) })));
router.get('/me/transactions', authenticate, validate(z.object({ query: z.object({
  role: z.enum(['buyer', 'seller']).default('buyer'), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict() })), asyncHandler(async (req, res) => res.json({ success: true, data: await transactionService.history(req.user.id, req.validated.query) })));
router.get('/:id/profile', validate(z.object({ params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }) })),
  asyncHandler(async (req, res) => res.json({ success: true, data: await userService.publicProfile(req.params.id) })));
router.get('/:id/reviews', validate(z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }),
  query: z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict()
})), asyncHandler(async (req, res) => res.json({ success: true, data: await transactionService.publicReviews(req.validated.params.id, req.validated.query) })));
router.patch('/me', authenticate, validate(updateMeSchema), asyncHandler(userController.updateMe));
router.post('/me/avatar', authenticate, uploadAvatar, asyncHandler(userController.updateAvatar));
export default router;
