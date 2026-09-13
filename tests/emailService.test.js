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
