import { expect, it } from 'vitest';
import { resolveApiUrl, publicApiUrl } from '../../mobile/src/config/apiUrl.js';
it('usa a API pública em distribuição sem configuração ou com loopback', () => {
  for (const value of [undefined, '', 'http://localhost:3000/api/v1', 'http://127.0.0.1:3000/api/v1', 'http://10.0.2.2:3000/api/v1']) {
    expect(resolveApiUrl(value, false)).toBe(publicApiUrl);
  }
});
it('preserva a API local em desenvolvimento', () => {
  expect(resolveApiUrl(undefined, true)).toBe('http://localhost:3000/api/v1');
  expect(resolveApiUrl('http://localhost:3000/api/v1', true)).toBe('http://localhost:3000/api/v1');
});
it('preserva endereços remotos explícitos', () => {
  expect(resolveApiUrl(' https://api.example.com/api/v1/ ', false)).toBe('https://api.example.com/api/v1');
});
