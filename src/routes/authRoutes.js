import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter, forgotPasswordLimiter } from '../middleware/rateLimiters.js';
import { changePasswordSchema, emailSchema, loginSchema, logoutSchema, refreshSchema, registerSchema, resendEmailVerificationSchema, resetPasswordSchema, verifyEmailSchema } from '../validators/authValidators.js';

const router = Router();
const action = (handler) => asyncHandler(handler.bind(authController));

router.post('/register', authLimiter, validate(registerSchema), action(authController.register));
router.post('/login', authLimiter, validate(loginSchema), action(authController.login));
router.post('/refresh', authLimiter, validate(refreshSchema), action(authController.refresh));
router.post('/logout', validate(logoutSchema), action(authController.logout));
router.post('/logout-all', authenticate, action(authController.logoutAll));
router.get('/me', authenticate, action(authController.me));
router.post('/forgot-password', forgotPasswordLimiter, validate(emailSchema), action(authController.forgotPassword));
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), action(authController.resetPassword));
router.post('/change-password', authenticate, authLimiter, validate(changePasswordSchema), action(authController.changePassword));
router.post('/send-email-verification', authenticate, authLimiter, action(authController.sendEmailVerification));
router.post('/resend-email-verification', authLimiter, validate(resendEmailVerificationSchema), action(authController.resendEmailVerification));
router.post('/verify-email', authLimiter, validate(verifyEmailSchema), action(authController.verifyEmail));

export default router;
