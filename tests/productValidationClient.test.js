import { expect, it } from 'vitest';
import { validateProduct } from '../../mobile/src/utils/validators.js';
import { productSaveError } from '../../mobile/src/utils/productErrors.js';
import { createProductSchema } from '../src/validators/productValidators.js';

const product = {
  title: 'Tomates da horta', description: 'Tomates frescos da nossa horta.', price: '47',
  unit: '€/kg', category: 'Legumes', municipalityCode: '0901', parishCode: '090103',
  locality: 'Dornelas', latitude: '40.8', longitude: '-7.5', locationSource: 'parish',
};

it('identifica hahaha na descrição antes do envio, tal como o backend', () => {
  const form = { ...product, title: 'hahaha', description: 'hahaha' };
  expect(validateProduct(form)).toEqual({ description: 'A descrição deve ter entre 10 e 2000 caracteres.' });
  const server = createProductSchema.safeParse({ body: form });
  expect(server.success).toBe(false);
  expect(server.error.issues.map(issue => issue.path.join('.'))).toEqual(['body.description']);
});

it.each([
  ['title', 'a', false], ['title', 'ab', true], ['title', 'a'.repeat(120), true], ['title', 'a'.repeat(121), false],
  ['description', 'a'.repeat(9), false], ['description', 'a'.repeat(10), true],
  ['description', 'a'.repeat(2000), true], ['description', 'a'.repeat(2001), false],
  ['description', '   hahaha   ', false], ['description', '   ', false],
  ['locality', 'a'.repeat(120), true], ['locality', 'a'.repeat(121), false],
  ['price', '1000000', true], ['price', '1000000.01', false],
])('alinha os limites de %s com o backend (caso %#)', (field, value, valid) => {
  const form = { ...product, [field]: value };
  expect(Object.keys(validateProduct(form)).length === 0).toBe(valid);
  expect(createProductSchema.safeParse({ body: form }).success).toBe(valid);
});

it('identifica o campo rejeitado pelo servidor numa mensagem legível', () => {
  const parsed = createProductSchema.safeParse({ body: { ...product, description: 'hahaha', price: -1 } });
  const feedback = productSaveError({ code: 'VALIDATION_ERROR', details: parsed.error.issues.map(issue => ({ field: issue.path.slice(1).join('.'), message: issue.message })) });
  expect(feedback.errors).toEqual({
    description: 'A descrição deve ter entre 10 e 2000 caracteres.',
    price: 'Indica um preço superior a zero e até 1 000 000 €.',
  });
  expect(feedback.message).toContain('descrição');
  expect(feedback.message).toContain('preço');
  expect(feedback.message).not.toContain('Os dados enviados são inválidos');
});

it('associa erros de coordenadas e fotografias às secções do formulário', () => {
  const feedback = productSaveError({ code: 'VALIDATION_ERROR', details: [
    { field: 'imageOrder.0.url' }, { field: 'imageOrder.1.url' }, { field: 'latitude' }, { field: 'longitude' },
  ] });
  expect(Object.keys(feedback.errors)).toEqual(['photos', 'location']);
  expect(feedback.message.split('\n')).toHaveLength(2);
});

it('conserva os erros de ligação e conflitos de edição e tolera detalhes desconhecidos', () => {
  expect(productSaveError({ code: 'PRODUCT_IMAGES_CHANGED', message: 'Reabre a edição.' })).toEqual({ errors: {}, message: 'Reabre a edição.' });
  expect(productSaveError(new Error('Sem ligação.')).message).toBe('Sem ligação.');
  for (const details of [null, {}, [null], [{ field: '' }], [{ field: 'newServerField' }], [{ field: '__proto__' }]]) {
    expect(productSaveError({ code: 'VALIDATION_ERROR', details })).toEqual({ errors: {}, message: 'Não foi possível validar o anúncio. Revê os dados e tenta novamente.' });
  }
});
