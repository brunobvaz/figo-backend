import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

function validate(overrides = {}) {
 const childEnv = {
  ...process.env, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'development',
  PASSWORD_RESET_URL: 'https://links.figo-app.com/reset-password',
  PASSWORD_RESET_SEND_IN_DEVELOPMENT: 'false', ...overrides
 };
 for (const key of ['RESEND_API_KEY', 'EMAIL_FROM']) {
  if (!(key in overrides)) delete childEnv[key];
 }
 return spawnSync(process.execPath, ['--input-type=module', '-e', 'import "./src/config/env.js"'], { env: childEnv, encoding: 'utf8' });
}
it('desenvolvimento continua a arrancar sem credenciais', () => {
 expect(validate().status).toBe(0);
});
it.each(['production', 'development'])('exige credenciais para envio real em %s', (mode) => {
 const result = validate({ NODE_ENV: mode, PASSWORD_RESET_SEND_IN_DEVELOPMENT: 'true' });
 expect(result.status).not.toBe(0);
 expect(result.stderr).toContain('RESEND_API_KEY');
 expect(result.stderr).toContain('EMAIL_FROM');
});
it('aceita envio explícito em desenvolvimento com credenciais', () => {
 expect(validate({ PASSWORD_RESET_SEND_IN_DEVELOPMENT: 'true', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Figo <test@example.com>' }).status).toBe(0);
});
it.each(['http://example.com/reset-password', 'javascript:alert(1)', 'https://example.com/reset#fragment'])('rejeita URL de recuperação inadequado: %s', (url) => {
 expect(validate({ PASSWORD_RESET_URL: url }).status).not.toBe(0);
});
