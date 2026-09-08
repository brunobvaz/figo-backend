import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { productService } from '../src/services/productService.js';
import { resolveLocation } from '../src/services/locationService.js';
import { createProductSchema, updateProductSchema, listProductsSchema } from '../src/validators/productValidators.js';
let mongo;
const location = { municipalityCode: '0302', parishCode: '0302FA', locality: 'Lugar', latitude: 41, longitude: -8, locationSource: 'gps' };
const base = { title: 'Produto', description: 'Descrição de teste', price: 2, unit: '€/kg', category: 'Frutas' };
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Product.init(); });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Product.deleteMany({});
  const db = mongoose.connection.db;
  await db.collection('referenceDatasets').updateOne({ _id: 'caop' }, { $set: { activeVersion: 'CAOP2025' } }, { upsert: true });
  await db.collection('municipalities').updateOne({ code: '0302' }, { $set: { version: 'CAOP2025', name: 'Barcelos' } }, { upsert: true });
  await db.collection('parishes').updateOne({ code: '0302FA' }, { $set: { version: 'CAOP2025', municipalityCode: '0302', name: 'Freguesia' } }, { upsert: true });
});
it('valida códigos alfanuméricos, coordenadas e alterações completas', () => {
  expect(createProductSchema.safeParse({ body: { ...base, ...location } }).success).toBe(true);
  for (const latitude of ['', null, ' ', 91, 'NaN']) expect(createProductSchema.safeParse({ body: { ...base, ...location, latitude } }).success).toBe(false);
  expect(updateProductSchema.safeParse({ body: { parishCode: '0302FA' } }).success).toBe(false);
  expect(updateProductSchema.safeParse({ body: { title: 'Novo título' } }).success).toBe(true);
  expect(listProductsSchema.safeParse({ query: { latitude: 41 } }).success).toBe(false);
});
it('valida relação administrativa e guarda GeoJSON', async () => {
  const result = await resolveLocation(location);
  expect(result.geo.coordinates).toEqual([-8, 41]); expect(result.address.version).toBe('CAOP2025');
  await expect(resolveLocation({ ...location, municipalityCode: '9999' })).rejects.toThrow('A freguesia');
});
it('expõe listas filtradas', async () => {
  const result = await request(app).get('/api/v1/locations/parishes?municipalityCode=0302');
  expect(result.status).toBe(200); expect(result.body.data.items[0].code).toBe('0302FA');
  expect((await request(app).get('/api/v1/locations/parishes?municipalityCode=9999')).body.data.items).toEqual([]);
});
it('ordena e pagina por distância, omite GPS e exclui vendidos/sem coordenadas', async () => {
  const seller = new mongoose.Types.ObjectId();
  await Product.create([
    { ...base, location: 'Antigo', seller },
    { ...base, location: 'Perto', seller, geo: { type: 'Point', coordinates: [-8, 41] } },
    { ...base, location: 'Mais longe', seller, geo: { type: 'Point', coordinates: [-8.01, 41] } },
    { ...base, location: 'Vendido', seller, status: 'sold', geo: { type: 'Point', coordinates: [-8, 41] } }
  ]);
  const q = { latitude: 41, longitude: -8, radiusKm: 5, page: 1, limit: 1 };
  const first = await productService.list(q);
  expect(first.pagination.total).toBe(2); expect(first.items[0].location).toBe('Perto'); expect(first.items[0].geo).toBeUndefined(); expect(first.items[0].id).toBeTruthy();
  expect((await productService.list({ ...q, page: 2 })).items[0].location).toBe('Mais longe');
  expect((await productService.list({ ...q, category: 'Mel' })).pagination.total).toBe(0);
  expect((await productService.list({ ...q, search: '[' })).pagination.total).toBe(0);
  expect((await Product.findOne({ location: 'Perto' })).toJSON().geo).toBeUndefined();
});
