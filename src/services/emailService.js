import { env } from '../config/env.js';

export const emailService = {
  async sendPasswordReset(email, token) {
    const separator = env.APP_URL.endsWith('/') ? '' : '/';
    if (env.NODE_ENV === 'development') console.info(`[EmailService] Reset para ${email}: ${env.APP_URL}${separator}reset-password?token=${token}`);
  },
  async sendEmailVerification(email, code) {
    if (env.NODE_ENV === 'development') console.info(`[EmailService] Código de verificação para ${email}: ${code}`);
  }
};
