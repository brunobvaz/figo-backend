import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export const emailService = {
  async sendPasswordReset(email, token) {
    const separator = env.APP_URL.endsWith('/') ? '' : '/';
    if (env.NODE_ENV === 'development') console.info(`[EmailService] Reset para ${email}: ${env.APP_URL}${separator}reset-password?token=${token}`);
  },
  async sendEmailVerification(email, code) {
    // Local development exposes devCode in the API; tests never send real mail.
    if (env.NODE_ENV !== 'production') return;
    const minutes = env.EMAIL_OTP_EXPIRES_IN_MINUTES;
    const text = `O teu código de verificação Figo é: ${code}.\n\nÉ válido durante ${minutes} minutos. Não partilhes este código.\nSe não fizeste este pedido, ignora este email.`;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'O teu código de verificação Figo', text,
          html: `<div lang="pt" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;color:#29232e"><h1 style="color:#713d88">Verifica o teu email</h1><p>Introduz este código na aplicação Figo:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#713d88">${code}</p><p>Válido durante ${minutes} minutos. Não partilhes este código.</p><p>Se não fizeste este pedido, ignora este email.</p></div>` })
      });
      if (!response.ok) throw new Error('Email rejected');
      const result = await response.json();
      if (!result.id) throw new Error('Invalid email response');
    } catch {
      // Never expose provider responses, credentials or OTPs in errors/logs.
      throw new AppError(502, 'EMAIL_SEND_FAILED', 'Não foi possível enviar o código por email. Tenta novamente dentro de instantes.');
    }
  }
};
