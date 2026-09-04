import { Router } from 'express';
import { userController } from '../controllers/userController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { updateMeSchema } from '../validators/userValidators.js';
import { uploadAvatar } from '../middleware/avatarUpload.js';

const router = Router();
router.patch('/me', authenticate, validate(updateMeSchema), asyncHandler(userController.updateMe));
router.post('/me/avatar', authenticate, uploadAvatar, asyncHandler(userController.updateAvatar));
router.post('/me/enable-seller', authenticate, asyncHandler(userController.enableSeller));
export default router;
