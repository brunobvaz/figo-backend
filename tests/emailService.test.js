import { afterEach, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { emailService } from '../src/services/emailService.js';
const original = { ...env };
afterEach(() => { Object.assign(env, original); vi.unstubAllGlobals(); });
it('não envia emails em desenvolvimento ou testes', async () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 for (const mode of ['development', 'test']) { env.NODE_ENV = mode; await emailService.sendEmailVerification('test@example.com', '123456'); }
 expect(fetch).not.toHaveBeenCalled();
});
it('envia o código gerado em produção com remetente configurado', async () => {
 Object.assign(env, { NODE_ENV: 'production', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Figo <otp@mail.example.com>' });
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sent' }) }); vi.stubGlobal('fetch', fetch);
 await emailService.sendEmailVerification('test@example.com', '123456');
 const [url, options] = fetch.mock.calls[0];
 expect(url).toBe('https://api.resend.com/emails');
 expect(JSON.parse(options.body)).toMatchObject({ from: env.EMAIL_FROM, to: ['test@example.com'], text: expect.stringContaining('123456'), html: expect.stringContaining('123456') });
});
it.each(['rejected', 'network', 'invalid'])('devolve erro recuperável sem expor dados: %s', async mode => {
 env.NODE_ENV = 'production';
 vi.stubGlobal('fetch', vi.fn(async () => { if (mode === 'network') throw Error('secret'); return { ok: mode !== 'rejected', json: async () => ({}) }; }));
 await expect(emailService.sendEmailVerification('test@example.com', '123456')).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED', statusCode: 502 });
});

it('envia link HTTPS com token e validade pelo Resend em produção', async () => {
 Object.assign(env, { NODE_ENV: 'production', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Figo <otp@mail.example.com>', PASSWORD_RESET_URL: 'https://links.figo-app.com/reset-password?source=email', PASSWORD_RESET_EXPIRES_IN_MINUTES: 30 });
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sent' }) }); vi.stubGlobal('fetch', fetch);
 await emailService.sendPasswordReset('test@example.com', 'token+with&characters');
 const [endpoint, options] = fetch.mock.calls[0];
 const body = JSON.parse(options.body);
 expect(endpoint).toBe('https://api.resend.com/emails');
 expect(options.headers.Authorization).toBe('Bearer test-key');
 expect(body).toMatchObject({ from: env.EMAIL_FROM, to: ['test@example.com'], subject: 'Redefine a tua palavra-passe Figo' });
 const link = new URL(body.text.match(/https:\/\/\S+/)[0]);
 expect(link.pathname).toBe('/reset-password');
 expect(link.searchParams.get('token')).toBe('token+with&characters');
 expect(link.searchParams.get('source')).toBe('email');
 expect(body.html).toContain('&amp;token=');
 expect(body.text).toContain('30 minutos');
});
it('desenvolvimento sem envio mostra link local e não chama Resend', async () => {
 Object.assign(env, { NODE_ENV: 'development', PASSWORD_RESET_SEND_IN_DEVELOPMENT: false });
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 try {
  await emailService.sendPasswordReset('test@example.com', 'test-token');
  expect(fetch).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('https://links.figo-app.com/reset-password?token=test-token'));
 } finally { log.mockRestore(); }
});
it('permite envio de recuperação em desenvolvimento sem ativar OTP', async () => {
 Object.assign(env, { NODE_ENV: 'development', PASSWORD_RESET_SEND_IN_DEVELOPMENT: true });
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sent' }) }); vi.stubGlobal('fetch', fetch);
 await emailService.sendPasswordReset('test@example.com', 'test-token');
 await emailService.sendEmailVerification('test@example.com', '123456');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('nunca envia recuperação real em testes mesmo com opção ativa', async () => {
 Object.assign(env, { NODE_ENV: 'test', PASSWORD_RESET_SEND_IN_DEVELOPMENT: true });
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 await emailService.sendPasswordReset('test@example.com', 'test-token');
 expect(fetch).not.toHaveBeenCalled();
});
it.each(['rejected', 'network', 'invalid', 'json'])('protege dados nas falhas de recuperação: %s', async mode => {
 env.NODE_ENV = 'production';
 vi.stubGlobal('fetch', vi.fn(async () => {
  if (mode === 'network') throw Error('provider-secret');
  return { ok: mode !== 'rejected', json: async () => { if (mode === 'json') throw Error('provider-secret'); return {}; } };
 }));
 await expect(emailService.sendPasswordReset('test@example.com', 'private-token')).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED', statusCode: 502, message: 'Não foi possível enviar o email de recuperação. Tenta novamente dentro de instantes.' });
});
