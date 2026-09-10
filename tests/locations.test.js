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
const location = { municipalityCode: '0302', parishCode: '0302FA', locality: 'Lugar', latitude: 41, longitude: -8, locationSource: 'parish' };
const base = { title: 'Produto', description: 'Descrição de teste', price: 2, unit: '€/kg', category: 'Frutas' };
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Product.init(); });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Product.deleteMany({});
  const db = mongoose.connection.db;
  await db.collection('referenceDatasets').updateOne({ _id: 'caop' }, { $set: { activeVersion: 'CAOP2025' } }, { upsert: true });
  await db.collection('municipalities').updateOne({ code: '0302' }, { $set: { version: 'CAOP2025', name: 'Barcelos' } }, { upsert: true });
  await db.collection('parishes').updateOne({ code: '0302FA' }, { $set: { version: 'CAOP2025', municipalityCode: '0302', name: 'Freguesia', latitude: 41, longitude: -8 } }, { upsert: true });
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

it('usa o ponto da freguesia em vez de coordenadas fornecidas pelo cliente', async () => {
  await mongoose.connection.db.collection('parishes').updateOne({ code: '0302FA' }, { $set: { latitude: 41.5, longitude: -8.5 } });
  const input = { ...base, ...location, locationSource: 'parish' };
  expect(createProductSchema.safeParse({ body: input }).success).toBe(true);
  const resolved = await resolveLocation(input);
  expect(resolved.geo.coordinates).toEqual([-8.5, 41.5]);
  expect(resolved.locationSource).toBe('parish');
  const product = await Product.create({ ...resolved, seller: new mongoose.Types.ObjectId() });
  expect(product.locationSource).toBe('parish');
  const updated = await productService.update(product.seller.toString(), product.id, { locality: 'Novo lugar' });
  expect(updated.address.locality).toBe('Novo lugar');
  expect(updated.geo.coordinates).toEqual([-8.5, 41.5]);
  const response = await request(app).get('/api/v1/locations/parishes?municipalityCode=0302');
  expect(response.body.data.items[0]).toMatchObject({ latitude: 41.5, longitude: -8.5 });
});
it('recusa freguesia sem ponto e origens GPS/manual', async () => {
  await mongoose.connection.db.collection('parishes').updateOne({ code: '0302FA' }, { $unset: { latitude: '', longitude: '' } });
  await expect(resolveLocation({ ...location, locationSource: 'parish' })).rejects.toThrow('ponto de referência');
  for (const locationSource of ['gps', 'manual']) expect(createProductSchema.safeParse({ body: { ...base, ...location, locationSource } }).success).toBe(false);
});

it('filtra anúncios e contagem pelo vendedor sem incluir outras contas', async () => {
  const first = new mongoose.Types.ObjectId(); const second = new mongoose.Types.ObjectId();
  await Product.create([
    { ...base, location: 'Local A', seller: first },
    { ...base, location: 'Local B', seller: second },
    { ...base, location: 'Removido', seller: first, status: 'deleted' }
  ]);
  const result = await productService.list({ sellerId: first.toString(), page: 1, limit: 100 });
  expect(result.pagination.total).toBe(1);
  expect(result.items.map(x => x.location)).toEqual(['Local A']);
});

it('combina preço, categoria e ordenação antes de paginar', async () => {
  const seller = new mongoose.Types.ObjectId();
  await Product.create([
    { ...base, title: 'Barato', price: 2, location: 'A', seller },
    { ...base, title: 'Médio', price: 8, location: 'B', seller },
    { ...base, title: 'Caro', price: 20, location: 'C', seller },
    { ...base, title: 'Outra categoria', price: 7, category: 'Mel', location: 'D', seller }
  ]);
  const query = { minPrice: 5, maxPrice: 20, category: 'Frutas', sort: 'price_desc', page: 1, limit: 1 };
  const first = await productService.list(query);
  expect(first.pagination.total).toBe(2);
  expect(first.items[0].price).toBe(20);
  expect((await productService.list({ ...query, page: 2 })).items[0].price).toBe(8);
  expect((await productService.list({ ...query, sort: 'price_asc' })).items[0].price).toBe(8);
});
it('aplica preço e ordenação também na pesquisa por proximidade', async () => {
  const seller = new mongoose.Types.ObjectId();
  await Product.create([
    { ...base, title: 'Perto caro', price: 15, location: 'A', seller, geo: { type: 'Point', coordinates: [-8, 41] } },
    { ...base, title: 'Perto barato', price: 5, location: 'B', seller, geo: { type: 'Point', coordinates: [-8.01, 41] } },
    { ...base, title: 'Fora do raio', price: 1, location: 'C', seller, geo: { type: 'Point', coordinates: [-9, 39] } }
  ]);
  const query = { latitude: 41, longitude: -8, radiusKm: 5, page: 1, limit: 20 };
  expect((await productService.list({ ...query, sort: 'price_asc' })).items.map(p => p.price)).toEqual([5, 15]);
  expect((await productService.list({ ...query, sort: 'distance' })).items.map(p => p.price)).toEqual([15, 5]);
  expect((await productService.list({ ...query, maxPrice: 10 })).pagination.total).toBe(1);
});
it('valida filtros de preço e ordenação', () => {
  for (const query of [{ minPrice: -1 }, { minPrice: 10, maxPrice: 5 }, { maxPrice: 'abc' }, { sort: 'invalid' }, { sort: 'distance' }]) {
    expect(listProductsSchema.safeParse({ query }).success).toBe(false);
  }
  expect(listProductsSchema.safeParse({ query: { minPrice: '0', maxPrice: '10', sort: 'price_asc' } }).success).toBe(true);
  expect(listProductsSchema.safeParse({ query: { latitude: 41, longitude: -8, sort: 'distance' } }).success).toBe(true);
});
