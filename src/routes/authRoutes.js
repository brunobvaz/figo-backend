import { accountService } from '../services/accountService.js';
import { accountActionSchema, accountReceiptSchema } from '../validators/authValidators.js';
import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter, forgotPasswordLimiter, refreshLimiter, verificationSendLimiter } from '../middleware/rateLimiters.js';
import { changePasswordSchema, emailSchema, loginSchema, logoutSchema, refreshSchema, registerSchema, resendEmailVerificationSchema, resetPasswordSchema, verifyEmailSchema } from '../validators/authValidators.js';

const router = Router();
const action = (handler) => asyncHandler(handler.bind(authController));

router.post('/register', verificationSendLimiter, validate(registerSchema), action(authController.register));
router.post('/login', authLimiter, validate(loginSchema), action(authController.login));
router.post('/refresh', refreshLimiter, validate(refreshSchema), action(authController.refresh));
router.post('/logout', validate(logoutSchema), action(authController.logout));
router.post('/logout-all', authenticate, action(authController.logoutAll));
router.get('/me', authenticate, action(authController.me));
router.post('/forgot-password', forgotPasswordLimiter, validate(emailSchema), action(authController.forgotPassword));
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), action(authController.resetPassword));
router.post('/change-password', authenticate, authLimiter, validate(changePasswordSchema), action(authController.changePassword));
router.post('/send-email-verification', authenticate, verificationSendLimiter, action(authController.sendEmailVerification));
router.post('/resend-email-verification', verificationSendLimiter, validate(resendEmailVerificationSchema), action(authController.resendEmailVerification));
router.post('/verify-email', authLimiter, validate(verifyEmailSchema), action(authController.verifyEmail));

for (const [path, method] of [['deletion-receipt', 'prepareDeletion'], ['deactivate', 'deactivate'], ['reactivate', 'reactivate'], ['delete', 'remove']]) {
  router.post(`/account/${path}`, authLimiter, validate(accountActionSchema), asyncHandler(async (req, res) => {
    const data = await accountService[method](req.body, { userAgent: req.get('user-agent') || null, ip: req.ip || null });
    res.status(data.status === 'deletion_pending' ? 202 : 200).json({ success: true, data });
  }));
}
router.post('/account/deletion-status', refreshLimiter, validate(accountReceiptSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await accountService.deletionStatus(req.body.receipt) });
}));
export default router;
