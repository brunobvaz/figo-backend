import { expect, it } from 'vitest';
import { normalizeProductPhotos, editableProductPhotos, addSelectedPhotos, photoSubmission, MAX_PHOTO_BYTES } from '../../mobile/src/utils/productPhotos.js';
const base = 'https://api.example.test';
const asset = index => ({ assetId: `asset-${index}`, uri: `file:///photo-${index}.jpg`, fileSize: 1024, mimeType: 'image/jpeg' });
it('mantém a fotografia anterior como primeira imagem, incluindo URLs legados', () => {
  expect(normalizeProductPhotos({ imageFilename: 'old.jpg' }, base)).toEqual([{ filename: 'old.jpg', uri: `${base}/uploads/products/old.jpg` }]);
  expect(normalizeProductPhotos({ image: 'https://example.test/old.jpg' }, base)[0].uri).toBe('https://example.test/old.jpg');
  expect(normalizeProductPhotos({}, base)).toEqual([]);
});
it('preserva a ordem da galeria e cria referências editáveis sem voltar a enviar ficheiros guardados', () => {
  const images = normalizeProductPhotos({ images: [{ filename: 'b.jpg' }, { filename: 'a.jpg' }] }, base);
  const photos = editableProductPhotos({ images });
  expect(photoSubmission(photos)).toEqual({ order: [{ filename: 'b.jpg' }, { filename: 'a.jpg' }], uploads: [] });
});
it('limita a seis mesmo quando o seletor nativo devolve mais fotografias', () => {
  const first = addSelectedPhotos([], [asset(0), asset(1)]).photos;
  const result = addSelectedPhotos(first, Array.from({ length: 8 }, (_, index) => asset(index)));
  expect(result.photos).toHaveLength(6); expect(result.excess).toBe(2);
  expect(result.photos.map(photo => photo.asset.assetId)).toEqual(['asset-0', 'asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5']);
});
it('ignora duplicados e rejeita ficheiros grandes ou de formatos não suportados', () => {
  const result = addSelectedPhotos([], [asset(0), asset(0), { ...asset(1), fileSize: MAX_PHOTO_BYTES + 1 }, { ...asset(2), mimeType: 'image/gif' }]);
  expect(result.photos).toHaveLength(1); expect(result.tooLarge).toBe(1); expect(result.unsupported).toBe(1);
});
it('recalcula os índices dos uploads ao remover e escolher a capa, preservando ficheiros existentes', () => {
  const current = editableProductPhotos({ images: normalizeProductPhotos({ images: [{ filename: 'existing.jpg' }] }, base) });
  const selected = addSelectedPhotos(current, [asset(0), asset(1), asset(2)]).photos;
  const final = [selected[3], selected[0], selected[1]];
  expect(photoSubmission(final)).toEqual({ order: [{ upload: 0 }, { filename: 'existing.jpg' }, { upload: 1 }], uploads: [asset(2), asset(0)] });
  expect(current).toHaveLength(1);
});
