import { Router } from 'express';
import { productController } from '../controllers/productController.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createProductSchema, listProductsSchema, productIdSchema, updateProductSchema } from '../validators/productValidators.js';
import { uploadProductImage } from '../middleware/productImageUpload.js';

const router = Router();
const action = (handler) => asyncHandler(handler.bind(productController));
router.get('/', validate(listProductsSchema), action(productController.list));
router.get('/mine', authenticate, validate(listProductsSchema), action(productController.mine));
router.get('/:id', optionalAuthenticate, validate(productIdSchema), action(productController.getById));
router.post('/', authenticate, uploadProductImage, validate(createProductSchema), action(productController.create));
router.patch('/:id', authenticate, validate(productIdSchema), uploadProductImage, validate(updateProductSchema), action(productController.update));
router.delete('/:id', authenticate, validate(productIdSchema), action(productController.remove));
export default router;
