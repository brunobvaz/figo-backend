import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { imageDelivery } from '../src/middleware/imageDelivery.js';
import { imageVariant, removeImageVariants } from '../src/services/imageService.js';

let directory, original;
const app = express();
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'figo-image-test-'));
  const raw = Buffer.alloc(1600 * 1200 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 17 + Math.floor(i / 4800)) % 256;
  original = await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  await fs.writeFile(path.join(directory, 'photo.png'), original);
  app.use('/images', imageDelivery(directory));
});
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it('reduz resolução e tamanho sem modificar o original', async () => {
  const file = await imageVariant(directory, 'photo.png', 640);
  const metadata = await sharp(file).metadata();
  expect(metadata).toMatchObject({ width: 640, height: 480, format: 'jpeg' });
  expect((await fs.stat(file)).size).toBeLessThan(original.length / 5);
  expect(await fs.readFile(path.join(directory, 'photo.png'))).toEqual(original);
});
it('partilha pedidos concorrentes e reutiliza a versão em disco', async () => {
  const paths = await Promise.all(Array.from({ length: 6 }, () => imageVariant(directory, 'photo.png', 320)));
  expect(new Set(paths).size).toBe(1);
  const before = await fs.stat(paths[0]);
  expect(await imageVariant(directory, 'photo.png', 320)).toBe(paths[0]);
  expect((await fs.stat(paths[0])).mtimeMs).toBe(before.mtimeMs);
  expect((await fs.readdir(path.dirname(paths[0]))).some(name => name.endsWith('.tmp'))).toBe(false);
});
it('corrige orientação e não amplia imagens pequenas', async () => {
  const small = await sharp({ create: { width: 60, height: 100, channels: 3, background: 'orange' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await fs.writeFile(path.join(directory, 'portrait.jpg'), small);
  const metadata = await sharp(await imageVariant(directory, 'portrait.jpg', 160)).metadata();
  expect(metadata).toMatchObject({ width: 100, height: 60 });
  expect(metadata.orientation).toBeUndefined();
});
it('entrega variantes JPEG com cache longa e respostas condicionais', async () => {
  const response = await request(app).get('/images/photo.png?w=640&v=1');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/image\/jpeg/);
  expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(response.headers.etag).toBeTruthy();
  expect((await request(app).get('/images/photo.png?w=640&v=1').set('If-None-Match', response.headers.etag)).status).toBe(304);
});
it('preserva URLs antigas e limita os tamanhos disponíveis', async () => {
  const response = await request(app).get('/images/photo.png');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/image\/png/);
  expect((await request(app).get('/images/photo.png?w=999999')).status).toBe(400);
  await expect(imageVariant(directory, '../photo.png', 640)).rejects.toMatchObject({ code: 'INVALID_IMAGE_VARIANT' });
});
it('faz fallback sem cache permanente quando o original não pode ser processado', async () => {
  await fs.writeFile(path.join(directory, 'invalid.jpg'), Buffer.from('invalid'));
  const response = await request(app).get('/images/invalid.jpg?w=160');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
});
it('não entrega uma miniatura de um ficheiro já removido e permite limpeza', async () => {
  await fs.writeFile(path.join(directory, 'removed.png'), original);
  const variant = await imageVariant(directory, 'removed.png', 160);
  await fs.unlink(path.join(directory, 'removed.png'));
  expect((await request(app).get('/images/removed.png?w=160')).status).toBe(404);
  await removeImageVariants(directory, 'removed.png');
  await expect(fs.access(variant)).rejects.toMatchObject({ code: 'ENOENT' });
});
