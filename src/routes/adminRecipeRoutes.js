import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { adminRecipeService } from '../services/adminRecipeService.js';
import { recipeImageUpload } from '../middleware/recipeImageUpload.js';
import { createRecipeSchema, updateRecipeSchema, recipeIdSchema, listRecipesSchema } from '../validators/recipeValidators.js';

// Mounted after adminRequestGuard and authenticateAdmin in adminRoutes.
const router = Router();
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
router.get('/', validate(listRecipesSchema), asyncHandler(async (req, res) => ok(res, await adminRecipeService.list(req.validated.query))));
router.post('/', recipeImageUpload, validate(createRecipeSchema), asyncHandler(async (req, res) => ok(res, await adminRecipeService.create(req.body, req.admin._id, req.file), 201)));
router.get('/:id/image', validate(recipeIdSchema), asyncHandler(async (req, res) => {
  const image = await adminRecipeService.image(req.params.id);
  res.type(image.contentType).set('Content-Disposition', 'inline').send(image.data);
}));
router.get('/:id', validate(recipeIdSchema), asyncHandler(async (req, res) => ok(res, await adminRecipeService.get(req.params.id))));
router.patch('/:id', validate(recipeIdSchema), recipeImageUpload, validate(updateRecipeSchema), asyncHandler(async (req, res) => ok(res, await adminRecipeService.update(req.params.id, req.body, req.admin._id, req.file))));
router.delete('/:id', validate(recipeIdSchema), asyncHandler(async (req, res) => ok(res, await adminRecipeService.remove(req.params.id))));
export default router;
