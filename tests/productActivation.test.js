import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { productService } from '../src/services/productService.js';
import { updateProductSchema } from '../src/validators/productValidators.js';
import { migrateProductActivation } from '../scripts/migrate-product-activation.js';
let mongo;
const seller = new mongoose.Types.ObjectId();
const base = { title: 'Brócolos', description: 'Brócolos frescos da horta.', price: 3.5, unit: '€/kg', category: 'Legumes', location: 'Lavra', seller };
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Product.init(); await User.collection.insertOne({ _id: seller, name: 'Vendedor' }); });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Product.deleteMany({}); });
it('aplica defaults e mantém disponibilidade independente da publicação', async () => {
 const p = await Product.create(base);
 expect(p.status).toBe('active'); expect(p.is_active).toBe(true);
 await productService.update(String(seller), p.id, { status: 'sold' });
 let result = await productService.update(String(seller), p.id, { is_active: false });
 expect(result.status).toBe('sold'); expect(result.is_active).toBe(false);
 result = await productService.update(String(seller), p.id, { is_active: true });
 expect(result.status).toBe('sold');
 await expect(productService.update(String(new mongoose.Types.ObjectId()), p.id, { status: 'active' })).rejects.toMatchObject({ statusCode: 403 });
});
it('oculta inativos do público e permite consulta pelo proprietário', async () => {
 const p = await Product.create({ ...base, is_active: false });
 expect((await request(app).get(`/api/v1/products/${p.id}`)).status).toBe(404);
 expect((await request(app).get('/api/v1/products/mine')).status).toBe(401);
 expect((await productService.list({ sellerId: String(seller), page: 1, limit: 20 })).items).toHaveLength(0);
 expect((await productService.list({ sellerId: String(seller), page: 1, limit: 20 }, String(seller))).items).toHaveLength(1);
 expect((await productService.getById(p.id, String(seller))).id).toBe(p.id);
});
it('mantém esgotados visíveis na pesquisa geográfica, respeitando availableOnly', async () => {
 await Product.create({ ...base, status: 'sold', geo: { type: 'Point', coordinates: [-8, 41] } });
 const q = { latitude: 41, longitude: -8, page: 1, limit: 20 };
 expect((await productService.list(q)).items).toHaveLength(1);
 expect((await productService.list({ ...q, availableOnly: true })).items).toHaveLength(0);
});
it('valida estados e interpreta false de multipart sem coerção incorreta', () => {
 expect(updateProductSchema.parse({ body: { is_active: 'false' } }).body.is_active).toBe(false);
 for (const body of [{ is_active: 'yes' }, { is_active: 1 }, { status: 'deleted' }, { status: 'invalid' }]) expect(updateProductSchema.safeParse({ body }).success).toBe(false);
});
it('migra apenas campos ausentes, preserva esgotados e é idempotente', async () => {
 await Product.collection.insertOne({ ...base, status: 'sold' });
 await Product.create({ ...base, is_active: false });
 expect((await migrateProductActivation(mongoose.connection.db)).modifiedCount).toBe(1);
 expect((await migrateProductActivation(mongoose.connection.db)).modifiedCount).toBe(0);
 expect(await Product.countDocuments({ is_active: false })).toBe(1);
 expect(await Product.countDocuments({ status: 'sold', is_active: true })).toBe(1);
});

it('aceita alterações autenticadas de estado por JSON e multipart sem imagem', async () => {
 const { Session } = await import('../src/models/Session.js');
 const { tokenService } = await import('../src/services/tokenService.js');
 await User.collection.updateOne({ _id: seller }, { $set: { status: 'active', } });
 const session = await Session.create({ userId: seller, refreshTokenHash: 'test', expiresAt: new Date(Date.now() + 60000) });
 const token = tokenService.generateAccessToken({ id: String(seller), }, session.id);
 const p = await Product.create(base);
 const url = `/api/v1/products/${p.id}`;
 let response = await request(app).patch(url).auth(token, { type: 'bearer' }).send({ status: 'sold' });
 expect(response.status).toBe(200); expect(response.body.data.status).toBe('sold');
 response = await request(app).patch(url).auth(token, { type: 'bearer' }).send({ is_active: false });
 expect(response.status).toBe(200); expect(response.body.data.is_active).toBe(false);
 response = await request(app).patch(url).auth(token, { type: 'bearer' }).field('is_active', 'true');
 expect(response.status).toBe(200); expect(response.body.data.is_active).toBe(true); expect(response.body.data.status).toBe('sold');
});

it('retira o anúncio das listas ao desativar e repõe ao ativar', async () => {
 const p = await Product.create(base);
 const q = { page: 1, limit: 20 };
 expect((await productService.list(q)).items.map(item => item.id)).toContain(p.id);
 const inactive = await productService.update(String(seller), p.id, { is_active: false });
 expect(inactive.is_active).toBe(false);
 expect((await productService.list(q)).items).toHaveLength(0);
 const active = await productService.update(String(seller), p.id, { is_active: true });
 expect(active.is_active).toBe(true);
 expect((await productService.list(q)).items.map(item => item.id)).toContain(p.id);
});

it('colheita é opcional e é desativada ao sair das categorias elegíveis', async () => {
 const p = await Product.create(base);
 expect(p.self_harvest).toBe(false);
 let updated = await productService.update(String(seller), p.id, { self_harvest: true });
 expect(updated.self_harvest).toBe(true);
 updated = await productService.update(String(seller), p.id, { category: 'Mel' });
 expect(updated.self_harvest).toBe(false);
 updated = await productService.update(String(seller), p.id, { self_harvest: true });
 expect(updated.self_harvest).toBe(false);
 updated = await productService.update(String(seller), p.id, { category: 'Frutas', self_harvest: true });
 expect(updated.self_harvest).toBe(true);
 expect(updateProductSchema.parse({ body: { self_harvest: 'false' } }).body.self_harvest).toBe(false);
 expect(updateProductSchema.safeParse({ body: { self_harvest: 'yes' } }).success).toBe(false);
});
