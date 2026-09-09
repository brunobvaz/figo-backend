import { expect, it } from 'vitest';
import { parsePrice, formatPriceInput } from '../../mobile/src/utils/price.js';
it('converte vírgula e ponto para o valor enviado à API', () => {
  expect(parsePrice('7,50')).toBe(7.5);
  expect(parsePrice('7.50')).toBe(7.5);
  expect(formatPriceInput(7.5)).toBe('7,50');
  expect(formatPriceInput('7')).toBe('7,00');
});
it('rejeita valores malformados sem os arredondar silenciosamente', () => {
  for (const value of ['', 'abc', '7,5,0', '7.555', 'Infinity']) expect(parsePrice(value)).toBeNaN();
});
