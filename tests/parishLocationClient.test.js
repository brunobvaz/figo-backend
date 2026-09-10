import { describe, expect, it } from 'vitest';
import { applyProductAddress } from '../../mobile/src/utils/productLocation.js';
import { validateProductLocation } from '../../mobile/src/utils/validators.js';
const parish = { code: '010103', municipalityCode: '0101', latitude: 40.5, longitude: -8.4 };
const address = { municipalityCode: '0101', parishCode: '010103' };
describe('localização por freguesia', () => {
  it('preenche coordenadas e permite guardar sem escolher pin', () => {
    const form = applyProductAddress({}, address, parish);
    expect(form).toMatchObject({ latitude: 40.5, longitude: -8.4, locationSource: 'parish', locationChanged: true });
    expect(validateProductLocation({ ...form, locality: 'Lugar' })).toBe('');
  });
  it('preserva pin manual ao alterar apenas a localidade', () => {
    const form = { ...address, latitude: 41, longitude: -8, locationSource: 'manual', locationChanged: false };
    expect(applyProductAddress(form, { locality: 'Outro lugar' })).toMatchObject({ ...form, locality: 'Outro lugar', localityChanged: true });
    expect(applyProductAddress(form, address, parish)).toMatchObject(form);
  });
  it('substitui o ponto e limpa a localidade ao mudar de freguesia', () => {
    const form = applyProductAddress({ parishCode: '010101', locality: 'Antiga', locationSource: 'manual', latitude: 42 }, address, parish);
    expect(form).toMatchObject({ latitude: 40.5, locationSource: 'parish', locality: '' });
  });
  it('limpa coordenadas antigas quando não há referência válida', () => {
    for (const reference of [undefined, { ...parish, latitude: null }, { ...parish, municipalityCode: '9999' }]) {
      expect(applyProductAddress({ latitude: 41, longitude: -8 }, address, reference)).toMatchObject({ latitude: '', longitude: '', locationChanged: true });
    }
    expect(applyProductAddress({ ...address, latitude: 41 }, { municipalityCode: '0201', parishCode: '' })).toMatchObject({ parishCode: '', latitude: '' });
  });
});
