import { authService } from '../services/authService.js';

const metadata = (req) => ({ userAgent: req.get('user-agent') || null, ip: req.ip || null });
const ok = (res, data = null, status = 200) => res.status(status).json({ success: true, data });

export const authController = {
  async register(req, res) { ok(res, await authService.register(req.body), 201); },
  async login(req, res) { ok(res, await authService.login(req.body, metadata(req))); },
  async refresh(req, res) { ok(res, await authService.refresh(req.body.refreshToken, metadata(req))); },
  async logout(req, res) { await authService.logout(req.body.refreshToken); ok(res, { message: 'Sessão terminada.' }); },
  async logoutAll(req, res) { await authService.logoutAll(req.user.id); ok(res, { message: 'Todas as sessões foram terminadas.' }); },
  async me(req, res) { ok(res, authService.getCurrentUser(req.user)); },
  async forgotPassword(req, res) { await authService.forgotPassword(req.body.email); ok(res, { message: 'Se existir uma conta com esse email, serão enviadas instruções de recuperação.' }); },
  async resetPassword(req, res) { await authService.resetPassword(req.body.token, req.body.newPassword); ok(res, { message: 'Password alterada com sucesso.' }); },
  async changePassword(req, res) { await authService.changePassword(req.user.id, req.auth.sessionId, req.body.currentPassword, req.body.newPassword); ok(res, { message: 'Password alterada com sucesso.' }); },
  async sendEmailVerification(req, res) { ok(res, await authService.sendEmailVerification(req.user.id)); },
  async resendEmailVerification(req, res) { ok(res, await authService.resendEmailVerification(req.body.challengeId)); },
  async verifyEmail(req, res) { ok(res, await authService.verifyEmail(req.body, metadata(req))); }
};
