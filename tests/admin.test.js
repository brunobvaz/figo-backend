import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import argon2 from 'argon2';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from '../src/app.js';
import { Admin } from '../src/models/Admin.js';
import { AdminSession } from '../src/models/AdminSession.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Transaction } from '../src/models/Transaction.js';
import { Session } from '../src/models/Session.js';
import { PushDevice } from '../src/models/PushDevice.js';
import { tokenService } from '../src/services/tokenService.js';
import { hashAdminToken } from '../src/middleware/authenticateAdmin.js';

let mongo, passwordHash, admin, user, cookie;
const password = 'secure-admin-password-2026';
const headers = { 'X-Figo-Backoffice': '1', Origin: 'http://localhost:5173' };
const get = path => request(app).get(`/api/v1/admin${path}`).set(headers).set('Cookie', cookie);
const patch = (path, body) => request(app).patch(`/api/v1/admin${path}`).set(headers).set('Cookie', cookie).send(body);
const login = (email = 'admin@figo.test', secret = password) => request(app).post('/api/v1/admin/auth/login').set(headers).send({ email, password: secret });
const makeProduct = overrides => Product.create({ title: 'Figos frescos', description: 'Da nossa quinta.', price: 3.5, unit: '€/kg', category: 'Frutas', location: 'Porto', seller: user._id, ...overrides });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all([Admin.init(), AdminSession.init(), User.init(), Product.init(), Transaction.init()]);
  passwordHash = await argon2.hash(password);
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Admin, AdminSession, User, Product, Transaction, Session, PushDevice].map(model => model.deleteMany({})));
  admin = await Admin.create({ name: 'Administrador Figo', email: 'admin@figo.test', passwordHash });
  user = await User.create({ name: 'Bruno Vaz', email: 'user@figo.test', passwordHash, termsAcceptedAt: new Date(), status: 'active' });
  const response = await login(); expect(response.status).toBe(200); cookie = response.headers['set-cookie'][0].split(';')[0];
});
it('guarda os administradores numa collection separada, sem expor hashes', async () => {
  expect(Admin.collection.name).toBe('admins'); expect(await User.countDocuments()).toBe(1);
  const response = await get('/auth/me'); expect(response.status).toBe(200);
  expect(response.body.data.admin).toEqual({ id: admin.id, name: admin.name, email: admin.email });
  const session = await AdminSession.findOne().select('+tokenHash');
  expect(session.tokenHash).toBe(hashAdminToken(cookie.split('=')[1]));
  expect(session.tokenHash).not.toBe(cookie.split('=')[1]);
});
it('recusa credenciais e tokens de users em todas as rotas administrativas', async () => {
  expect((await login(user.email)).status).toBe(401);
  const session = await Session.create({ userId: user._id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 60000) });
  const token = tokenService.generateAccessToken(user, session.id);
  for (const path of ['/auth/me', '/dashboard', '/products', '/users', '/categories', '/transactions', '/reports/export']) {
    const response = await request(app).get(`/api/v1/admin${path}`).set(headers).auth(token, { type: 'bearer' });
    expect(response.status, path).toBe(401);
  }
  for (const path of [`/products/${new mongoose.Types.ObjectId()}`, `/users/${user.id}/status`]) {
    expect((await request(app).patch(`/api/v1/admin${path}`).set(headers).auth(token, { type: 'bearer' }).send({ status: 'suspended' })).status).toBe(401);
  }
});
it('uma sessão administrativa não autentica nas rotas da aplicação móvel', async () => {
  const response = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
  expect(response.status).toBe(401);
});
it('aplica cookie HttpOnly, SameSite e não permite origem externa nem pedidos sem header', async () => {
  const response = await login();
  expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
  expect(response.headers['set-cookie'][0]).toContain('Path=/api/v1/admin');
  expect((await request(app).get('/api/v1/admin/users').set('Cookie', cookie)).status).toBe(403);
  expect((await request(app).post('/api/v1/admin/auth/logout').set('Cookie', cookie).set({ ...headers, Origin: 'https://evil.test' })).status).toBe(403);
  expect(await AdminSession.countDocuments()).toBe(2);
});
it('permite login pelo endereço local anunciado pelo Vite, mantendo origens e portas restritas', async () => {
  const origin = 'http://127.0.0.1:5173';
  const response = await request(app).post('/api/v1/admin/auth/login')
    .set({ ...headers, Origin: origin }).send({ email: admin.email, password });
  expect(response.status).toBe(200);
  expect(response.headers['access-control-allow-origin']).toBe(origin);
  expect(response.headers['access-control-allow-credentials']).toBe('true');
  const localCookie = response.headers['set-cookie'][0].split(';')[0];
  expect((await request(app).get('/api/v1/admin/auth/me').set({ ...headers, Origin: origin }).set('Cookie', localCookie)).status).toBe(200);
  for (const blocked of ['http://127.0.0.1:5174', 'http://localhost:8081', 'http://127.0.0.1.evil.test:5173', 'null']) {
    expect((await request(app).get('/api/v1/admin/auth/me').set({ ...headers, Origin: blocked }).set('Cookie', localCookie)).status).toBe(403);
  }
});
it('revoga a sessão no logout e recusa sessões expiradas ou admins desativados', async () => {
  expect((await request(app).post('/api/v1/admin/auth/logout').set(headers).set('Cookie', cookie)).status).toBe(200);
  expect((await get('/auth/me')).status).toBe(401);
  let response = await login(); cookie = response.headers['set-cookie'][0].split(';')[0];
  await AdminSession.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await get('/auth/me')).status).toBe(401);
  response = await login(); cookie = response.headers['set-cookie'][0].split(';')[0];
  await Admin.updateOne({ _id: admin._id }, { $set: { status: 'disabled' } });
  expect((await get('/auth/me')).status).toBe(401);
  expect((await login()).status).toBe(401);
});
it('agrega dados reais, preenche os dias sem atividade e compara o período anterior', async () => {
  const product = await makeProduct();
  await Product.collection.updateOne({ _id: product._id }, { $set: { createdAt: new Date('2026-09-16T10:00:00Z') } });
  await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: new Date('2026-09-15T10:00:00Z') } });
  await Transaction.collection.insertMany([
    { product: product._id, seller: user._id, buyer: new mongoose.Types.ObjectId(), conversation: new mongoose.Types.ObjectId(), clientId: 'a', status: 'completed', completedAt: new Date('2026-09-16T20:00:00Z'), createdAt: new Date('2026-09-15'), totalPriceSnapshot: 7 },
    { product: product._id, seller: user._id, buyer: new mongoose.Types.ObjectId(), conversation: new mongoose.Types.ObjectId(), clientId: 'b', status: 'reviewed', completedAt: new Date('2026-09-14T20:00:00Z'), totalPriceSnapshot: 3.5 },
    { product: product._id, seller: user._id, buyer: new mongoose.Types.ObjectId(), conversation: new mongoose.Types.ObjectId(), clientId: 'c', status: 'pending', createdAt: new Date('2026-09-16'), totalPriceSnapshot: 50 }
  ]);
  const response = await get('/dashboard?from=2026-09-16&to=2026-09-17'); expect(response.status).toBe(200);
  const data = response.body.data;
  expect(data.stats.activeProducts).toBe(1); expect(data.stats.registeredUsers).toBe(1);
  expect(data.stats.transactions).toEqual({ value: 1, previous: 1 });
  expect(data.stats.revenue).toEqual({ value: 7, previous: 3.5 });
  expect(data.activity).toEqual([
    { date: '2026-09-16', products: 1, users: 0, transactions: 1, revenue: 7 },
    { date: '2026-09-17', products: 0, users: 0, transactions: 0, revenue: 0 }
  ]);
});
it('filtra anúncios, pagina os resultados e trata a pesquisa como texto literal', async () => {
  await makeProduct(); await makeProduct({ title: 'Pêras', category: 'Frutas' }); await makeProduct({ title: 'Couve', category: 'Legumes', is_active: false });
  let response = await get('/products?limit=1&page=2&category=Frutas');
  expect(response.body.data.pagination).toEqual({ page: 2, limit: 1, total: 2, pages: 2 });
  expect(response.body.data.items).toHaveLength(1);
  expect((await get('/products?status=inactive')).body.data.pagination.total).toBe(1);
  expect((await get('/products?search=.*')).body.data.pagination.total).toBe(0);
  expect((await get('/products?limit=1000')).status).toBe(422);
  expect((await get('/products?status=anything')).status).toBe(422);
});
it('edita apenas os campos autorizados e preserva o estado esgotado ao republicar', async () => {
  const product = await makeProduct({ status: 'sold', is_active: false });
  const response = await patch(`/products/${product.id}`, { title: 'Figos da quinta', category: 'Mel', price: 4, is_active: true });
  expect(response.status).toBe(200); expect(response.body.data.status).toBe('sold'); expect(response.body.data.is_active).toBe(true);
  expect((await patch(`/products/${product.id}`, { seller: admin.id })).status).toBe(422);
  expect((await patch(`/products/${product.id}`, { status: 'active' })).status).toBe(422);
  expect((await patch(`/products/${product.id}`, { price: -1 })).status).toBe(422);
  await Product.updateOne({ _id: product._id }, { $set: { status: 'deleted' } });
  expect((await patch(`/products/${product.id}`, { is_active: true })).status).toBe(409);
});
it('suspende utilizadores, revoga sessões e oculta os anúncios públicos sem os apagar', async () => {
  const product = await makeProduct();
  const session = await Session.create({ userId: user._id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 60000) });
  const token = tokenService.generateAccessToken(user, session.id);
  await PushDevice.create({ token: 'test-push', user: user._id, session: session._id, binding: 'binding', platform: 'ios' });
  expect((await patch(`/users/${user.id}/status`, { status: 'suspended' })).status).toBe(200);
  expect(await Session.countDocuments({ userId: user._id })).toBe(0); expect(await PushDevice.countDocuments()).toBe(0);
  expect((await request(app).get(`/api/v1/products/${product.id}`)).status).toBe(404);
  expect((await request(app).get('/api/v1/auth/me').auth(token, { type: 'bearer' })).status).toBe(403);
  expect((await get('/dashboard')).body.data.stats.activeProducts).toBe(0);
  expect((await get('/categories')).body.data.find(row => row.name === 'Frutas').active).toBe(0);
  expect((await patch(`/products/${product.id}`, { is_active: true })).status).toBe(409);
  expect((await patch(`/users/${user.id}/status`, { status: 'active' })).status).toBe(200);
  expect((await request(app).get(`/api/v1/products/${product.id}`)).status).toBe(200);
  expect((await request(app).get('/api/v1/auth/me').auth(token, { type: 'bearer' })).status).toBe(401);
});
it('não reativa contas eliminadas, em eliminação ou desativadas pelo proprietário', async () => {
  for (const status of ['deactivated', 'deleted', 'deletion_pending']) {
    await User.updateOne({ _id: user._id }, { $set: { status } });
    expect((await patch(`/users/${user.id}/status`, { status: 'active' })).status).toBe(409);
    expect((await User.findById(user.id)).status).toBe(status);
  }
});
it('não expõe passwords, tokens ou dados internos nas listas', async () => {
  const response = await get('/users');
  expect(response.status).toBe(200); expect(response.body.data.items[0].email).toBe(user.email);
  expect(JSON.stringify(response.body)).not.toContain('password'); expect(JSON.stringify(response.body)).not.toContain('termsAcceptedAt');
  expect((await request(app).post('/api/v1/admin/auth/register').set(headers).send({ email: 'intruder@test.com', password })).status).not.toBe(200);
});
it('valida intervalos de datas e exporta apenas métricas agregadas', async () => {
  for (const query of ['from=2026-02-31', 'from=2026-09-17&to=2026-09-01', 'from=2020-01-01&to=2026-01-01']) expect((await get(`/dashboard?${query}`)).status).toBe(422);
  const response = await get('/reports/export?from=2026-09-16&to=2026-09-17');
  expect(response.status).toBe(200); expect(response.headers['content-type']).toContain('text/csv');
  expect(response.text).toContain('2026-09-16;0;0;0;0,00');
  expect(response.headers['content-disposition']).toContain('figo-relatorio-2026-09-16-2026-09-17.csv');
  expect(response.text).not.toContain(user.email);
});

it('cria o primeiro administrador por CLI sem criar users nem substituir credenciais', async () => {
  const run = promisify(execFile);
  const env = { ...process.env, MONGODB_URI: mongo.getUri(), MONGODB_DB_NAME: mongoose.connection.name,
    ADMIN_NAME: 'Admin CLI', ADMIN_EMAIL: 'cli@figo.test', ADMIN_PASSWORD: password };
  await run(process.execPath, ['scripts/create-admin.js'], { env });
  const created = await Admin.findOne({ email: 'cli@figo.test' }).select('+passwordHash');
  expect(created.name).toBe('Admin CLI'); expect(await argon2.verify(created.passwordHash, password)).toBe(true);
  expect(await User.countDocuments()).toBe(1);
  await expect(run(process.execPath, ['scripts/create-admin.js'], { env })).rejects.toMatchObject({ code: 1 });
  expect(await Admin.countDocuments({ email: 'cli@figo.test' })).toBe(1);
});

it('só permite destacar no backoffice e mantém o destaque nas edições do vendedor', async () => {
  const product = await makeProduct();
  expect(product.featured).toBe(false);
  const session = await Session.create({ userId: user._id, refreshTokenHash: 'hash', expiresAt: new Date(Date.now() + 60000) });
  const token = tokenService.generateAccessToken(user, session.id);
  for (const body of [{ featured: true }, { title: 'Outro título', featured: true }]) {
    expect((await request(app).patch(`/api/v1/products/${product.id}`).auth(token, { type: 'bearer' }).send(body)).status).toBe(422);
  }
  expect((await request(app).patch(`/api/v1/products/${product.id}`).auth(token, { type: 'bearer' }).field('featured', 'true')).status).toBe(422);
  const createInput = { title: 'Figos da quinta', description: 'Figos frescos da nossa quinta.', category: 'Frutas', price: 3, unit: '€/kg', municipalityCode: '1703', parishCode: '170301', locality: 'Bustelo', latitude: 41.7, longitude: -7.4, locationSource: 'parish' };
  const { createProductSchema } = await import('../src/validators/productValidators.js');
  expect(createProductSchema.safeParse({ body: createInput }).success).toBe(true);
  expect((await request(app).post('/api/v1/products').auth(token, { type: 'bearer' }).send({ ...createInput, featured: true })).status).toBe(422);
  expect((await Product.findById(product.id)).featured).toBe(false);
  const featured = await patch(`/products/${product.id}`, { featured: true });
  expect(featured.status).toBe(200); expect(featured.body.data.featured).toBe(true);
  expect((await request(app).get(`/api/v1/products/${product.id}`)).body.data.featured).toBe(true);
  expect((await request(app).patch(`/api/v1/products/${product.id}`).auth(token, { type: 'bearer' }).send({ title: 'Figos da horta' })).status).toBe(200);
  expect((await Product.findById(product.id)).featured).toBe(true);
  expect((await patch(`/products/${product.id}`, { featured: 'false' })).status).toBe(422);
  expect((await patch(`/products/${product.id}`, { featured: false })).body.data.featured).toBe(false);
  expect((await request(app).get('/api/v1/products?featured=true')).body.data.items).toHaveLength(0);
});

it('filtra destaques antes da paginação, encontra anúncios antigos e trata registos sem flag como não destacados', async () => {
  const old = await makeProduct();
  await Product.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date('2020-01-01') }, $unset: { featured: '' } });
  const normal = (await request(app).get('/api/v1/products')).body.data.items[0];
  expect(normal.featured).toBe(false);
  expect((await request(app).get('/api/v1/products?featured=false')).body.data.pagination.total).toBe(1);
  await Product.insertMany(Array.from({ length: 55 }, (_, index) => ({ title: `Produto ${index}`, description: 'Produto da quinta.', price: 2, unit: '€/kg', category: 'Frutas', location: 'Porto', seller: user._id })));
  const second = await makeProduct();
  await patch(`/products/${old.id}`, { featured: true }); await patch(`/products/${second.id}`, { featured: true });
  const firstPage = await request(app).get('/api/v1/products?featured=true&limit=1');
  expect(firstPage.body.data.pagination).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });
  expect(firstPage.body.data.items[0].id).toBe(second.id);
  const lastPage = await request(app).get('/api/v1/products?featured=true&limit=1&page=2');
  expect(lastPage.body.data.items.map(item => item.id)).toEqual([old.id]);
  expect((await request(app).get('/api/v1/products?limit=50')).body.data.items.map(item => item.id)).not.toContain(old.id);
  expect((await request(app).get('/api/v1/products?featured=yes')).status).toBe(422);
  expect((await request(app).get('/api/v1/products?featured=false')).body.data.pagination.total).toBe(55);
});

it('o destaque não torna públicos anúncios inativos, removidos ou de contas suspensas', async () => {
  const product = await makeProduct({ geo: { type: 'Point', coordinates: [-8, 41] } });
  await patch(`/products/${product.id}`, { featured: true });
  const search = () => request(app).get('/api/v1/products?featured=true&latitude=41&longitude=-8&radiusKm=10');
  expect((await search()).body.data.pagination.total).toBe(1);
  await patch(`/products/${product.id}`, { is_active: false });
  expect((await search()).body.data.pagination.total).toBe(0);
  await patch(`/products/${product.id}`, { is_active: true });
  expect((await search()).body.data.items[0].featured).toBe(true);
  await patch(`/users/${user.id}/status`, { status: 'suspended' });
  expect((await search()).body.data.pagination.total).toBe(0);
  await patch(`/users/${user.id}/status`, { status: 'active' });
  await Product.updateOne({ _id: product._id }, { $set: { status: 'deleted' } });
  expect((await search()).body.data.pagination.total).toBe(0);
});
