import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { createEditorialImageUpload } from '../middleware/editorialImageUpload.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { adminEventService } from '../services/adminEventService.js';
import { createEventSchema, updateEventSchema, eventIdSchema, listEventsSchema } from '../validators/eventValidators.js';

// Mounted after adminRequestGuard and authenticateAdmin.
const router = Router();
const upload = createEditorialImageUpload('EVENT_UPLOAD_ERROR');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.get('/', validate(listEventsSchema), asyncHandler(async (req, res) => ok(res, await adminEventService.list(req.validated.query))));
router.post('/', upload, validate(createEventSchema), asyncHandler(async (req, res) => ok(res, await adminEventService.create(req.body, req.admin._id, req.file), 201)));
router.get('/:id/image', validate(eventIdSchema), asyncHandler(async (req, res) => {
  const image = await adminEventService.image(req.params.id);
  res.type(image.contentType).set('Content-Disposition', 'inline').send(image.data);
}));
router.get('/:id', validate(eventIdSchema), asyncHandler(async (req, res) => ok(res, await adminEventService.get(req.params.id))));
router.patch('/:id', validate(eventIdSchema), upload, validate(updateEventSchema), asyncHandler(async (req, res) => ok(res, await adminEventService.update(req.params.id, req.body, req.admin._id, req.file))));
router.delete('/:id', validate(eventIdSchema), asyncHandler(async (req, res) => ok(res, await adminEventService.remove(req.params.id))));
export default router;
