import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { authService } from '../src/services/authService.js';
import { accountService } from '../src/services/accountService.js';
import { processProductImageCleanup } from '../src/services/productImageCleanup.js';
import { purgeImage, imageVariant } from '../src/services/imageService.js';
import { productUploadDirectory } from '../src/config/uploads.js';
import { migrateProductImages } from '../scripts/migrate-product-images.js';

let mongo, hash, auth, seller, buffers;
const createdFiles = new Set();
const originalWrite = fs.writeFile.bind(fs);
const password = 'Password!123';
const fields = { title: 'Maçãs da horta', description: 'Maçãs frescas colhidas hoje.', price: '2.5', unit: '€/kg', category: 'Frutas', municipalityCode: '0407', parishCode: '040701', locality: 'Abambres', latitude: '41.48', longitude: '-7.18', locationSource: 'parish' };
async function createPhotos(count = 3) {
  let call = request(app).post('/api/v1/products').auth(auth.accessToken, { type: 'bearer' });
  for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
  call = call.field('imageOrder', JSON.stringify(Array.from({ length: count }, (_, upload) => ({ upload }))));
  for (let index = 0; index < count; index++) call = call.attach('images', buffers[index % buffers.length], { filename: `${index}.jpg`, contentType: 'image/jpeg' });
  return call;
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  hash = await argon2.hash(password);
  buffers = await Promise.all(['#ee2211', '#22ee11', '#1122ee', '#eeee11', '#ee11ee', '#11eeee'].map(background => sharp({ create: { width: 24, height: 24, channels: 3, background } }).jpeg().toBuffer()));
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  const db = mongoose.connection.db;
  await Promise.all(['referenceDatasets', 'municipalities', 'parishes'].map(name => db.collection(name).deleteMany({})));
  await db.collection('referenceDatasets').insertOne({ _id: 'caop', activeVersion: 'CAOP2025' });
  await db.collection('municipalities').insertOne({ code: '0407', name: 'Mirandela', version: 'CAOP2025' });
  await db.collection('parishes').insertOne({ code: '040701', municipalityCode: '0407', name: 'Abambres', version: 'CAOP2025', latitude: 41.48, longitude: -7.18 });
  seller = await User.create({ name: 'Teste', email: 'photos@example.test', passwordHash: hash, emailVerified: true, termsAcceptedAt: new Date() });
  auth = await authService.login({ email: seller.email, password }, {});
  vi.spyOn(fs, 'writeFile').mockImplementation(async (target, ...args) => {
    if (typeof target === 'string' && path.dirname(target) === productUploadDirectory) createdFiles.add(path.basename(target));
    return originalWrite(target, ...args);
  });
});
afterEach(async () => { vi.restoreAllMocks(); for (const filename of createdFiles) await purgeImage(productUploadDirectory, filename); createdFiles.clear(); });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

it('publica seis fotografias e devolve a mesma capa e ordem no detalhe e nas listas', async () => {
  const response = await createPhotos(6);
  expect(response.status).toBe(201);
  const product = response.body.data;
  expect(product.images).toHaveLength(6); expect(product.imagesRevision).toBe(0);
  expect(product.imageFilename).toBe(product.images[0].filename);
  for (let i = 0; i < 6; i++) expect(await fs.readFile(path.join(productUploadDirectory, product.images[i].filename))).toEqual(buffers[i]);
  const detail = await request(app).get(`/api/v1/products/${product.id}`);
  expect(detail.body.data.images).toEqual(product.images);
  for (const url of ['/api/v1/products', '/api/v1/products?latitude=41.48&longitude=-7.18']) {
    const result = await request(app).get(url); expect(result.body.data.items[0].images).toEqual(product.images);
    expect(result.body.data.items[0].pendingImageFilenames).toBeUndefined();
  }
  const thumbnail = await request(app).get(`/uploads/products/${product.images[5].filename}?w=160`);
  expect(thumbnail.status).toBe(200); expect(thumbnail.headers['content-type']).toContain('image/jpeg');
});

it('recusa uma sétima fotografia, ficheiros grandes e tipos inválidos sem guardar anúncios', async () => {
  expect((await createPhotos(7)).status).toBe(422);
  for (const [buffer, type] of [[Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg'], [Buffer.from('text'), 'text/plain']]) {
    const result = await request(app).post('/api/v1/products').auth(auth.accessToken, { type: 'bearer' }).attach('images', buffer, { filename: 'test.jpg', contentType: type });
    expect(result.status).toBe(422);
  }
  expect(await Product.countDocuments()).toBe(0); expect(createdFiles.size).toBe(0);
});

it('permite remover, adicionar e escolher a capa, limpando originais e variantes removidos', async () => {
  const product = (await createPhotos()).body.data;
  const removed = product.images[0].filename;
  const variant = await imageVariant(productUploadDirectory, removed, 160);
  const order = [{ filename: product.images[2].filename }, { upload: 0 }, { filename: product.images[1].filename }];
  const edited = await request(app).patch(`/api/v1/products/${product.id}`).auth(auth.accessToken, { type: 'bearer' })
    .field('imageOrder', JSON.stringify(order)).field('imagesRevision', '0').attach('images', buffers[3], { filename: 'new.jpg', contentType: 'image/jpeg' });
  expect(edited.status).toBe(200); expect(edited.body.data.images).toHaveLength(3);
  expect(edited.body.data.imageFilename).toBe(product.images[2].filename); expect(edited.body.data.imagesRevision).toBe(1);
  expect(await fs.readFile(path.join(productUploadDirectory, edited.body.data.images[1].filename))).toEqual(buffers[3]);
  for (const target of [path.join(productUploadDirectory, removed), variant]) await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await request(app).get(`/uploads/products/${removed}`)).status).toBe(404);
  expect((await Product.findById(product.id).select('+pendingImageFilenames')).pendingImageFilenames).toEqual([]);
});

it('preserva a galeria numa edição de texto ou num cliente antigo que substitui só a capa', async () => {
  const product = (await createPhotos()).body.data;
  const url = `/api/v1/products/${product.id}`;
  const text = await request(app).patch(url).auth(auth.accessToken, { type: 'bearer' }).send({ title: 'Título atualizado' });
  expect(text.body.data.images).toEqual(product.images); expect(text.body.data.imagesRevision).toBe(0);
  const legacy = await request(app).patch(url).auth(auth.accessToken, { type: 'bearer' }).field('title', 'Título do cliente antigo').attach('image', buffers[3], { filename: 'cover.jpg', contentType: 'image/jpeg' });
  expect(legacy.status).toBe(200); expect(legacy.body.data.images.slice(1)).toEqual(product.images.slice(1));
  expect(legacy.body.data.images[0].filename).not.toBe(product.imageFilename);
});

it('recusa referências alheias, repetidas, incompletas e edições concorrentes desatualizadas', async () => {
  const a = (await createPhotos()).body.data;
  const b = (await createPhotos(1)).body.data;
  for (const imageOrder of [[], [b.images[0]], [a.images[0], a.images[0]], [{ upload: 0 }]]) {
    const response = await request(app).patch(`/api/v1/products/${a.id}`).auth(auth.accessToken, { type: 'bearer' }).send({ imageOrder, imagesRevision: 0 });
    expect(response.status).toBe(422);
  }
  const reversed = [...a.images].reverse();
  const changed = await request(app).patch(`/api/v1/products/${a.id}`).auth(auth.accessToken, { type: 'bearer' }).send({ imageOrder: reversed, imagesRevision: 0 });
  expect(changed.status).toBe(200);
  const stale = await request(app).patch(`/api/v1/products/${a.id}`).auth(auth.accessToken, { type: 'bearer' }).send({ imageOrder: a.images, imagesRevision: 0 });
  expect(stale.status).toBe(409); expect(stale.body.error.code).toBe('PRODUCT_IMAGES_CHANGED');
  expect((await Product.findById(a.id)).images.map(p => p.filename)).toEqual(reversed.map(p => p.filename));
});

it('limpa uploads parciais se uma fotografia estiver corrompida e mantém a galeria anterior', async () => {
  const product = (await createPhotos(1)).body.data;
  const previousFiles = new Set(createdFiles);
  const response = await request(app).patch(`/api/v1/products/${product.id}`).auth(auth.accessToken, { type: 'bearer' })
    .field('imageOrder', JSON.stringify([{ upload: 0 }, { upload: 1 }])).field('imagesRevision', '0')
    .attach('images', buffers[1], { filename: 'valid.jpg', contentType: 'image/jpeg' })
    .attach('images', Buffer.from('not an image'), { filename: 'invalid.jpg', contentType: 'image/jpeg' });
  expect(response.status).toBe(422);
  expect((await Product.findById(product.id)).images.map(p => p.filename)).toEqual(product.images.map(p => p.filename));
  for (const filename of createdFiles) if (!previousFiles.has(filename)) await expect(fs.stat(path.join(productUploadDirectory, filename))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('repete a limpeza de uma fotografia removida após uma falha de disco', async () => {
  const product = (await createPhotos(2)).body.data;
  const originalUnlink = fs.unlink.bind(fs);
  const filename = product.images[1].filename;
  vi.spyOn(fs, 'unlink').mockImplementation(async target => {
    if (target === path.join(productUploadDirectory, filename)) throw Object.assign(Error('blocked'), { code: 'EACCES' });
    return originalUnlink(target);
  });
  const result = await request(app).patch(`/api/v1/products/${product.id}`).auth(auth.accessToken, { type: 'bearer' }).send({ imageOrder: [product.images[0]], imagesRevision: 0 });
  expect(result.status).toBe(200);
  expect((await Product.findById(product.id).select('+pendingImageFilenames')).pendingImageFilenames).toContain(filename);
  fs.unlink.mockRestore();
  await processProductImageCleanup();
  await expect(fs.stat(path.join(productUploadDirectory, filename))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await Product.findById(product.id).select('+pendingImageFilenames')).pendingImageFilenames).toEqual([]);
});

it('a remoção do anúncio e da conta limpam todas as fotografias', async () => {
  const a = (await createPhotos(3)).body.data;
  const b = (await createPhotos(6)).body.data;
  expect((await request(app).delete(`/api/v1/products/${a.id}`).auth(auth.accessToken, { type: 'bearer' })).status).toBe(204);
  for (const photo of a.images) await expect(fs.stat(path.join(productUploadDirectory, photo.filename))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await accountService.remove({ email: seller.email, password })).status).toBe('deleted');
  for (const photo of b.images) await expect(fs.stat(path.join(productUploadDirectory, photo.filename))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('migra produtos legados, incluindo ocultos e removidos, sem alterar capa, estado ou datas', async () => {
  const date = new Date('2025-01-02');
  const ids = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
  await Product.collection.insertMany([
    { _id: ids[0], imageFilename: 'legacy.jpg', image: 'https://example.test/ignored.jpg', is_active: false, status: 'sold', createdAt: date, updatedAt: date },
    { _id: ids[1], image: 'https://example.test/legacy.jpg', status: 'deleted' },
    { _id: ids[2], image: null, imageFilename: null },
    { _id: ids[3], images: null, imageFilename: 'null-array.jpg' },
    { _id: ids[4], images: [{ filename: 'already.jpg' }, { filename: 'second.jpg' }], imagesRevision: 7 }
  ]);
  const dry = await migrateProductImages(mongoose.connection.db, { dryRun: true });
  expect(dry.pending).toBe(4); expect((await Product.collection.findOne({ _id: ids[0] })).images).toBeUndefined();
  expect((await migrateProductImages(mongoose.connection.db)).modifiedCount).toBe(4);
  expect((await migrateProductImages(mongoose.connection.db)).modifiedCount).toBe(0);
  expect(await Product.collection.findOne({ _id: ids[0] })).toMatchObject({ images: [{ filename: 'legacy.jpg' }], imageFilename: 'legacy.jpg', image: 'https://example.test/ignored.jpg', is_active: false, status: 'sold', createdAt: date, updatedAt: date });
  expect((await Product.collection.findOne({ _id: ids[1] })).images).toEqual([{ url: 'https://example.test/legacy.jpg' }]);
  expect((await Product.collection.findOne({ _id: ids[2] })).images).toEqual([]);
  expect((await Product.collection.findOne({ _id: ids[4] })).imagesRevision).toBe(7);
});
