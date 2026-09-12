import { expect, it } from 'vitest';
import { imageVariantUri } from '../../mobile/src/utils/imageVariants.js';

it('seleciona tamanhos limitados para avatar, card e detalhe', () => {
  const uri = 'https://figo.example/uploads/products/photo.jpg';
  expect(imageVariantUri(uri, 150)).toBe(`${uri}?w=160&v=1`);
  expect(imageVariantUri(uri, 500)).toBe(`${uri}?w=640&v=1`);
  expect(imageVariantUri(uri, 1280)).toBe(`${uri}?w=1280&v=1`);
  expect(imageVariantUri(uri, 9000)).toBe(`${uri}?w=1280&v=1`);
});
it('não altera ficheiros locais, assets nem URLs de serviços externos', () => {
  for (const uri of [undefined, 'file:///tmp/photo.jpg', 'content://photo.jpg', 'https://images.example/photo.jpg', 'data:image/png;base64,abc']) {
    expect(imageVariantUri(uri, 160)).toBe(uri);
  }
});
it('preserva parâmetros e não duplica opções de tamanho', () => {
  const uri = 'https://figo.example/uploads/avatars/avatar.png?token=abc&w=640';
  const result = new URL(imageVariantUri(uri, 160));
  expect(result.searchParams.get('token')).toBe('abc');
  expect(result.searchParams.getAll('w')).toEqual(['160']);
});
