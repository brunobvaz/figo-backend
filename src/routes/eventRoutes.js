import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicEventService } from '../services/publicEventService.js';
import { listPublicEventsSchema, publicEventDetailSchema, publicEventImageSchema } from '../validators/publicEventValidators.js';

// Public reading only. Writes remain protected under /admin/events.
const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', validate(listPublicEventsSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await publicEventService.list(req.validated.query) });
}));
router.get('/:id', validate(publicEventDetailSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await publicEventService.detail(req.validated.params.id) });
}));
router.get('/:id/image', validate(publicEventImageSchema), asyncHandler(async (req, res) => {
  const image = await publicEventService.image(req.validated.params.id, req.validated.query.v);
  res.type(image.contentType).set({ 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=0, must-revalidate' }).send(image.data);
}));
export default router;
