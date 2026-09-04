import { Router } from 'express';
import { productController } from '../controllers/productController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRoles } from '../middleware/authorizeRoles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createProductSchema, listProductsSchema, productIdSchema, updateProductSchema } from '../validators/productValidators.js';
import { uploadProductImage } from '../middleware/productImageUpload.js';

const router = Router();
const action = (handler) => asyncHandler(handler.bind(productController));
router.get('/', validate(listProductsSchema), action(productController.list));
router.get('/:id', validate(productIdSchema), action(productController.getById));
router.post('/', authenticate, authorizeRoles('seller'), uploadProductImage, validate(createProductSchema), action(productController.create));
router.patch('/:id', authenticate, authorizeRoles('seller'), validate(productIdSchema), uploadProductImage, validate(updateProductSchema), action(productController.update));
router.delete('/:id', authenticate, authorizeRoles('seller'), validate(productIdSchema), action(productController.remove));
export default router;
