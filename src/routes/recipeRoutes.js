import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicRecipeService } from '../services/publicRecipeService.js';
import { listPublicRecipesSchema, publicRecipeDetailSchema, publicRecipeImageSchema } from '../validators/publicRecipeValidators.js';

// Public reading only. Writes remain under /admin/recipes and its admin guards.
const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', validate(listPublicRecipesSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await publicRecipeService.list(req.validated.query) });
}));
router.get('/:id', validate(publicRecipeDetailSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await publicRecipeService.detail(req.validated.params.id) });
}));
router.get('/:id/image', validate(publicRecipeImageSchema), asyncHandler(async (req, res) => {
  const image = await publicRecipeService.image(req.params.id, req.validated.query.v);
  res.type(image.contentType).set({ 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=0, must-revalidate' }).send(image.data);
}));
export default router;
