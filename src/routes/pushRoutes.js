import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pushDeviceService } from '../services/pushDeviceService.js';
const router = Router();
const token = z.string().max(256).regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/);
router.use(authenticate);
router.put('/device', validate(z.object({ body: z.object({ token, platform: z.enum(['ios', 'android']) }) })), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await pushDeviceService.register(req.user.id, req.auth.sessionId, req.body) });
}));
router.delete('/device', validate(z.object({ body: z.object({ token }) })), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await pushDeviceService.remove(req.user.id, req.auth.sessionId, req.body.token) });
}));
export default router;
