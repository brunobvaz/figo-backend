import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import { app } from '../src/app.js';
import { Admin } from '../src/models/Admin.js';
import { AdminSession } from '../src/models/AdminSession.js';
import { Recipe } from '../src/models/Recipe.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { tokenService } from '../src/services/tokenService.js';
import mockRecipes from '../../mobile/src/data/mockRecipes.js';

let mongo, passwordHash, admin, cookie;
const password = 'Recipe-test-only-2026';
const headers = { Origin: 'http://localhost:5173', 'X-Figo-Backoffice': '1' };
const input = { title: 'Caldo verde', description: 'Uma sopa reconfortante com legumes da horta.', image: null,
  preparationMinutes: 35, difficulty: 'Fácil', categories: ['Sopas', 'Vegetarianas'],
  ingredients: ['2 batatas', '1 cebola', '200 g de couve'], seasonal: true, steps: ['Lava os legumes.', 'Coze e serve.'] };
const endpoint = '/api/v1/admin/recipes';
const call = (method, path = '') => request(app)[method](`${endpoint}${path}`).set(headers).set('Cookie', cookie);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Admin.init(), AdminSession.init(), Recipe.init(), User.init(), Session.init()]);
  passwordHash = await argon2.hash(password);
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Admin, AdminSession, Recipe, User, Session].map(model => model.deleteMany({})));
  admin = await Admin.create({ name: 'Editor Figo', email: 'recipes@figo.test', passwordHash });
  const login = await request(app).post('/api/v1/admin/auth/login').set(headers).send({ email: admin.email, password });
  expect(login.status).toBe(200);
  cookie = login.headers['set-cookie'][0].split(';')[0];
});

it('cria, consulta, edita e elimina uma receita persistida na collection recipes', async () => {
  const created = await call('post').send({ ...input, title: ' Caldo verde ' });
  expect(created.status).toBe(201);
  const recipe = created.body.data;
  expect(recipe).toMatchObject(input);
  expect(recipe.id).toMatch(/^[a-f0-9]{24}$/);
  expect(recipe).not.toHaveProperty('_id');
  expect(recipe).not.toHaveProperty('__v');
  expect(recipe).not.toHaveProperty('createdBy');
  expect(Recipe.collection.name).toBe('recipes');
  const stored = await Recipe.findById(recipe.id);
  expect(stored.createdBy.toString()).toBe(admin.id);
  expect(stored.updatedBy.toString()).toBe(admin.id);
  expect((await call('get', `/${recipe.id}`)).body.data).toEqual(recipe);
  const changed = await call('patch', `/${recipe.id}`).send({ title: 'Caldo da horta', seasonal: false, steps: ['Corta.', 'Coze.'] });
  expect(changed.status).toBe(200);
  expect(changed.body.data).toMatchObject({ title: 'Caldo da horta', seasonal: false, ingredients: input.ingredients, steps: ['Corta.', 'Coze.'] });
  expect((await Recipe.findById(recipe.id)).title).toBe('Caldo da horta');
  expect((await call('delete', `/${recipe.id}`)).status).toBe(200);
  expect(await Recipe.findById(recipe.id)).toBeNull();
  for (const method of ['get', 'patch', 'delete']) {
    const req = call(method, `/${recipe.id}`);
    const response = await (method === 'patch' ? req.send({ title: 'Outra receita' }) : req);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RECIPE_NOT_FOUND');
  }
});

it('aceita o contrato de todas as receitas mock, sem importar dados automaticamente', async () => {
  expect((await call('get')).body.data.items).toEqual([]);
  for (const { id, ...recipe } of mockRecipes) {
    const response = await call('post').send(recipe);
    expect(response.status, id).toBe(201);
    expect(response.body.data).toMatchObject({ ...recipe, steps: [] });
  }
  expect(await Recipe.countDocuments()).toBe(mockRecipes.length);
});

it('pesquisa texto literal e ingredientes, filtra e pagina com ordem estável', async () => {
  await Recipe.insertMany([
    { ...input, title: 'Receita [especial]', createdBy: admin._id, updatedBy: admin._id },
    { ...input, title: 'Salada', preparationMinutes: 15, seasonal: false, categories: ['Vegetarianas'], ingredients: ['Figos', 'Queijo'], createdBy: admin._id, updatedBy: admin._id },
    { ...input, title: 'Tarte', preparationMinutes: 50, difficulty: 'Média', categories: ['Doces'], createdBy: admin._id, updatedBy: admin._id }
  ]);
  expect((await call('get', '?search=%5Bespecial%5D')).body.data.items.map(recipe => recipe.title)).toEqual(['Receita [especial]']);
  expect((await call('get', '?search=figos')).body.data.items.map(recipe => recipe.title)).toEqual(['Salada']);
  const quick = await call('get', '?quick=true&seasonal=false&category=Vegetarianas&difficulty=F%C3%A1cil');
  expect(quick.body.data.items.map(recipe => recipe.title)).toEqual(['Salada']);
  expect((await call('get', '?seasonal=true')).body.data.pagination.total).toBe(2);
  const first = (await call('get', '?limit=2&page=1')).body.data;
  const second = (await call('get', '?limit=2&page=2')).body.data;
  expect(first.pagination).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
  expect([...first.items, ...second.items].map(recipe => recipe.id)).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map(recipe => recipe.id)).size).toBe(3);
  expect(first.categories).toEqual(['Doces', 'Sopas', 'Vegetarianas']);
  expect((await call('get', '?search=inexistente')).body.data.pagination.total).toBe(0);
});

it.each([
  ['title', ' '], ['description', 'curta'], ['preparationMinutes', 0], ['preparationMinutes', 1.5],
  ['preparationMinutes', 1441], ['difficulty', 'Impossível'], ['categories', []],
  ['categories', ['Sopas', ' sopas ']], ['ingredients', []], ['ingredients', [' ']],
  ['seasonal', 'true'], ['image', 'javascript:alert(1)'], ['image', 'http://example.com/a.jpg'],
  ['image', 'não é um URL'], ['image', 'https://user:password@example.com/a.jpg'],
  ['steps', ['']], ['steps', Array.from({ length: 21 }, () => 'Passo')], ['createdBy', '000000000000000000000001']
])('rejeita um valor inválido em %s sem gravar a receita (%j)', async (field, value) => {
  const response = await call('post').send({ ...input, [field]: value });
  expect(response.status).toBe(422);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(await Recipe.countDocuments()).toBe(0);
});

it('devolve campos inválidos identificados e rejeita edições vazias e filtros inválidos', async () => {
  const invalid = await call('post').send({ ...input, description: 'hahaha' });
  expect(invalid.body.error.details).toContainEqual({ field: 'description', message: 'A descrição deve ter pelo menos 10 caracteres.' });
  const recipe = (await call('post').send(input)).body.data;
  expect((await call('patch', `/${recipe.id}`).send({})).status).toBe(422);
  expect((await call('patch', `/${recipe.id}`).send({ ingredients: [] })).status).toBe(422);
  expect((await call('get', '/inválido')).status).toBe(422);
  for (const query of ['page=0', 'limit=101', 'seasonal=talvez', 'difficulty=Outra', 'search[$ne]=x'])
    expect((await call('get', `?${query}`)).status).toBe(422);
});

it('preserva campos opcionais no PATCH e permite limpar a imagem e os passos', async () => {
  const created = await call('post').send({ ...input, image: 'https://example.com/sopa.jpg' });
  const id = created.body.data.id;
  const changed = await call('patch', `/${id}`).send({ title: 'Sopa portuguesa' });
  expect(changed.body.data).toMatchObject({ image: 'https://example.com/sopa.jpg', seasonal: true, steps: input.steps });
  const cleared = await call('patch', `/${id}`).send({ image: null, steps: [] });
  expect(cleared.body.data).toMatchObject({ image: null, steps: [] });
});

it('aceita receitas extensas com texto UTF-8 dentro dos limites de cada campo', async () => {
  const response = await call('post').send({ ...input, description: 'É'.repeat(2000), steps: Array.from({ length: 20 }, () => 'ç'.repeat(500)) });
  expect(response.status).toBe(201);
});

it('restringe as rotas administrativas mesmo com leitura pública disponível', async () => {
  const user = await User.create({ name: 'Utilizador', email: 'user@figo.test', passwordHash, termsAcceptedAt: new Date() });
  const session = await Session.create({ userId: user._id, refreshTokenHash: 'test', expiresAt: new Date(Date.now() + 60000) });
  const token = tokenService.generateAccessToken(user, session.id);
  const id = new mongoose.Types.ObjectId().toString();
  for (const [method, path] of [['get', ''], ['post', ''], ['get', `/${id}`], ['patch', `/${id}`], ['delete', `/${id}`]]) {
    expect((await request(app)[method](`${endpoint}${path}`).set(headers).send()).status).toBe(401);
    expect((await request(app)[method](`${endpoint}${path}`).set(headers).auth(token, { type: 'bearer' }).send()).status).toBe(401);
    expect((await request(app)[method](`${endpoint}${path}`).set('Cookie', cookie).send()).status).toBe(403);
    expect((await request(app)[method](`${endpoint}${path}`).set({ ...headers, Origin: 'https://evil.test' }).set('Cookie', cookie).send()).status).toBe(403);
  }
  expect((await request(app).get('/api/v1/recipes')).status).toBe(200);
  await Admin.updateOne({ _id: admin._id }, { $set: { status: 'disabled' } });
  expect((await call('get')).status).toBe(401);
});

const photo = color => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer();

it('carrega, lê, preserva, substitui e remove uma fotografia persistida na própria receita', async () => {
  const first = await photo('#578266');
  const created = await call('post').field('data', JSON.stringify(input)).attach('image', first, { filename: 'receita.png', contentType: 'image/png' });
  expect(created.status).toBe(201);
  const recipe = created.body.data;
  expect(recipe.hasUploadedImage).toBe(true);
  expect(recipe.image).toMatch(new RegExp(`^${endpoint}/${recipe.id}/image\\?v=`));
  expect(recipe).not.toHaveProperty('imageData');
  expect((await Recipe.findById(recipe.id)).imageData).toBeUndefined();
  const stored = await Recipe.findById(recipe.id).select('+imageData');
  expect(Buffer.isBuffer(stored.imageData)).toBe(true);
  const delivered = await call('get', `/${recipe.id}/image`);
  expect(delivered.status).toBe(200);
  expect(delivered.headers['content-type']).toContain('image/webp');
  expect(delivered.headers['cache-control']).toBe('no-store');
  expect(await sharp(delivered.body).metadata()).toMatchObject({ format: 'webp', width: 1080, height: 1350 });
  expect(delivered.body.equals(stored.imageData)).toBe(true);
  const changed = await call('patch', `/${recipe.id}`).send({ title: 'Receita com fotografia' });
  expect(changed.body.data.image).toBe(recipe.image);
  expect((await call('get')).body.data.items[0]).not.toHaveProperty('imageData');
  const replacement = await call('patch', `/${recipe.id}`).field('data', '{}').attach('image', await photo('#ffa500'), { filename: 'nova.png', contentType: 'image/png' });
  expect(replacement.status).toBe(200);
  expect(replacement.body.data.image).not.toBe(recipe.image);
  expect(replacement.body.data.title).toBe('Receita com fotografia');
  expect((await call('get', `/${recipe.id}/image`)).body.equals(delivered.body)).toBe(false);
  const removed = await call('patch', `/${recipe.id}`).send({ image: null });
  expect(removed.body.data).toMatchObject({ image: null, hasUploadedImage: false });
  expect((await Recipe.findById(recipe.id).select('+imageData')).imageData).toBeNull();
  expect((await call('get', `/${recipe.id}/image`)).status).toBe(404);
});

it('não altera a receita se o upload for inválido e elimina a foto com a receita', async () => {
  const created = await call('post').field('data', JSON.stringify(input)).attach('image', await photo('#ffffff'), 'receita.png');
  const recipe = created.body.data;
  const invalid = await call('patch', `/${recipe.id}`).field('data', JSON.stringify({ title: 'Não deve gravar' })).attach('image', Buffer.from('not an image'), { filename: 'falsa.jpg', contentType: 'image/jpeg' });
  expect(invalid.status).toBe(422);
  const saved = (await call('get', `/${recipe.id}`)).body.data;
  expect(saved.title).toBe(input.title);
  expect(saved.image).toBe(recipe.image);
  const invalidFields = await call('patch', `/${recipe.id}`).field('data', JSON.stringify({ description: 'curta' })).attach('image', await photo('#ff0000'), 'outra.png');
  expect(invalidFields.status).toBe(422);
  expect((await call('get', `/${recipe.id}`)).body.data.image).toBe(recipe.image);
  expect((await call('delete', `/${recipe.id}`)).status).toBe(200);
  expect((await call('get', `/${recipe.id}/image`)).status).toBe(404);
  expect(await Recipe.findById(recipe.id).select('+imageData')).toBeNull();
});

it('permite trocar uma fotografia carregada por URL, sem manter o binário antigo', async () => {
  const created = await call('post').field('data', JSON.stringify(input)).attach('image', await photo('#000000'), 'receita.png');
  const id = created.body.data.id;
  const changed = await call('patch', `/${id}`).send({ image: 'https://example.com/receita.jpg' });
  expect(changed.body.data).toMatchObject({ image: 'https://example.com/receita.jpg', hasUploadedImage: false });
  expect((await call('get', `/${id}/image`)).status).toBe(404);
  expect((await Recipe.findById(id).select('+imageData')).imageData).toBeNull();
});

it('recusa ficheiros excessivos, formatos falsos, campos inesperados e dados inválidos', async () => {
  const valid = await photo('#ffffff');
  const requests = [
    call('post').field('data', JSON.stringify(input)).attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'grande.png'),
    call('post').field('data', JSON.stringify(input)).attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), { filename: 'falsa.png', contentType: 'image/png' }),
    call('post').field('data', JSON.stringify(input)).attach('image', valid, { filename: 'texto.txt', contentType: 'text/plain' }),
    call('post').field('data', JSON.stringify(input)).attach('image', valid, 'a.png').attach('image', valid, 'b.png'),
    call('post').field('data', 'JSON inválido').attach('image', valid, 'a.png'),
    call('post').field('data', JSON.stringify({ ...input, imageData: 'não permitido' })).attach('image', valid, 'a.png'),
    call('post').field('data', JSON.stringify({ ...input, image: 'https://example.com/image.jpg' })).attach('image', valid, 'a.png')
  ];
  for (const request of requests) expect((await request).status).toBe(422);
  expect(await Recipe.countDocuments()).toBe(0);
});

it('exige autenticação de administrador também para carregar e consultar a fotografia', async () => {
  const created = await call('post').field('data', JSON.stringify(input)).attach('image', await photo('#ff0000'), 'receita.png');
  const path = `${endpoint}/${created.body.data.id}/image`;
  expect((await request(app).get(path).set(headers)).status).toBe(401);
  expect((await request(app).get(path).set('Cookie', cookie)).status).toBe(403);
  expect((await request(app).post(endpoint).set(headers).field('data', JSON.stringify(input)).attach('image', await photo('#000000'), 'a.png')).status).toBe(401);
});
