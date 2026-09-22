import { expect, it } from 'vitest';
import sharp from 'sharp';
import { editorialImageFields } from '../src/services/editorialImageService.js';

const optimise = buffer => editorialImageFields({ buffer }, 'INVALID_EDITORIAL_IMAGE');

it.each([
  ['jpeg', 2400, 1600], ['png', 800, 1600], ['webp', 320, 240], ['png', 1080, 1350]
])('normaliza %s (%i × %i) para WebP 1080 × 1350, incluindo imagens pequenas', async (format, width, height) => {
  const source = await sharp({ create: { width, height, channels: 3, background: '#755197' } }).toFormat(format).toBuffer();
  const result = await optimise(source);
  expect(await sharp(result.imageData).metadata()).toMatchObject({ format: 'webp', width: 1080, height: 1350 });
  expect(result.imageMimeType).toBe('image/webp');
  expect(result.imageData.length).toBeLessThan(5 * 1024 * 1024);
  expect(result.image).toBeNull();
});

it('recorta ao centro em vez de deformar ou acrescentar margens à fotografia', async () => {
  // Only the green centre should remain after cropping a panoramic source.
  const source = await sharp(Buffer.from('<svg width="2700" height="1350"><rect width="2700" height="1350" fill="red"/><rect x="810" width="1080" height="1350" fill="#00ff00"/><rect x="1890" width="810" height="1350" fill="blue"/></svg>')).png().toBuffer();
  const result = await optimise(source);
  const { data, info } = await sharp(result.imageData).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[5, 5], [1074, 5], [5, 1344], [1074, 1344], [540, 675]]) {
    const pixel = (y * info.width + x) * info.channels;
    expect(data[pixel]).toBeLessThan(10);
    expect(data[pixel + 1]).toBeGreaterThan(245);
    expect(data[pixel + 2]).toBeLessThan(10);
  }
});

it('respeita a orientação da câmara antes de recortar e remove metadados', async () => {
  const source = await sharp(Buffer.from('<svg width="1350" height="1080"><rect width="1350" height="1080" fill="red"/><rect x="675" width="675" height="1080" fill="blue"/></svg>'))
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  expect((await sharp(source).metadata()).orientation).toBe(6);
  const result = await optimise(source);
  const metadata = await sharp(result.imageData).metadata();
  expect(metadata).toMatchObject({ width: 1080, height: 1350 });
  for (const key of ['orientation', 'exif', 'icc', 'xmp', 'iptc']) expect(metadata[key]).toBeUndefined();
  const { data, info } = await sharp(result.imageData).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const top = (150 * info.width + 540) * info.channels;
  const bottom = (1200 * info.width + 540) * info.channels;
  expect(data[top]).toBeGreaterThan(240); expect(data[top + 2]).toBeLessThan(15);
  expect(data[bottom]).toBeLessThan(15); expect(data[bottom + 2]).toBeGreaterThan(240);
});
