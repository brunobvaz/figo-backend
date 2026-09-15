import { expect, it } from 'vitest';
import { profileNameFields } from '../../mobile/src/utils/profileName.js';

it('preserva o nome composto e o apelido guardados no registo', () => {
  expect(profileNameFields({ name: 'Maria João da Silva', firstName: 'Maria João', lastName: 'da Silva' }))
    .toEqual({ firstName: 'Maria João', lastName: 'da Silva' });
  expect(profileNameFields({ firstName: ' Bruno ', lastName: ' Vaz ' }))
    .toEqual({ firstName: 'Bruno', lastName: 'Vaz' });
});

it('preserva nomes antigos para revisão sem adivinhar a separação do apelido', () => {
  expect(profileNameFields({ name: 'Maria João da Silva' }))
    .toEqual({ firstName: 'Maria João da Silva', lastName: '' });
});

it('não restaura dados antigos quando o nome completo já foi alterado', () => {
  expect(profileNameFields({ name: 'Ana dos Santos', firstName: 'Maria', lastName: 'Silva' }))
    .toEqual({ firstName: 'Ana dos Santos', lastName: '' });
});
