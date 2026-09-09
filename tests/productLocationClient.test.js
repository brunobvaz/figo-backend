import { describe, expect, it } from 'vitest';
import { validateProduct } from '../../mobile/src/utils/validators.js';
const product = { title: 'Tomates', description: 'Tomates da horta', price: '7.5', unit: '€/kg', category: 'Legumes', municipalityCode: '1703', parishCode: '170301', locality: 'Bustelo', latitude: '41.7', longitude: '-7.4', locationChanged: true };
describe('localização no formulário do produto', () => {
  it('permite editar sem reenviar a localização guardada', () => {
    expect(validateProduct({ ...product, locationChanged: false, latitude: '', longitude: '' })).toEqual({});
  });
  it.each([null, undefined, '', ' ', NaN, Infinity, 'abc', 91])('identifica o ponto em falta ou inválido: %s', latitude => {
    expect(validateProduct({ ...product, latitude }).location).toContain('Falta confirmar o ponto');
  });
  it('rejeita longitude fora dos limites e aceita zero', () => {
    expect(validateProduct({ ...product, longitude: 181 }).location).toBeTruthy();
    expect(validateProduct({ ...product, latitude: 0, longitude: 0 })).toEqual({});
  });
  it('remove o erro depois de confirmar o ponto', () => {
    expect(validateProduct(product)).toEqual({});
  });
  it.each([
    ['municipalityCode', 'Seleciona o concelho do produto.'],
    ['parishCode', 'Seleciona a freguesia do produto.'],
    ['locality', 'Indica a localidade do produto.'],
  ])('identifica o campo em falta: %s', (field, message) => {
    expect(validateProduct({ ...product, [field]: '' }).location).toBe(message);
  });
});
