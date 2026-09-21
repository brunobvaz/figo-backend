import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../src/app.js';
import { Admin } from '../src/models/Admin.js';
import { AdminSession } from '../src/models/AdminSession.js';
import { Recipe } from '../src/models/Recipe.js';

let mongo, admin, cookie, passwordHash;
const headers = { Origin: 'http://localhost:5173', 'X-Figo-Backoffice': '1' };
const input = { title: 'Sopa do backoffice', description: 'Uma sopa com legumes da horta.', preparationMinutes: 25, difficulty: 'Fácil', categories: ['Sopas', 'Vegetarianas'], ingredients: ['2 batatas'], seasonal: false, steps: ['Cozer as batatas.'] };
const adminCall = (method, path = '') => request(app)[method](`/api/v1/admin/recipes${path}`).set(headers).set('Cookie', cookie);
const list = query => request(app).get(`/api/v1/recipes${query || ''}`);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Admin.init(), AdminSession.init(), Recipe.init()]);
  passwordHash = await argon2.hash('Public-recipe-test-2026');
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Recipe, Admin, AdminSession].map(model => model.deleteMany({})));
  admin = await Admin.create({ name: 'Editor de receitas', email: 'editor@figo.test', passwordHash });
  const login = await request(app).post('/api/v1/admin/auth/login').set(headers).send({ email: admin.email, password: 'Public-recipe-test-2026' });
  cookie = login.headers['set-cookie'][0].split(';')[0];
});

it('mostra uma lista vazia sem introduzir receitas mock', async () => {
  const response = await list();
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.data).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
});

it('reflete criação, edição e eliminação administrativas apenas com campos públicos', async () => {
  const created = await adminCall('post').send(input);
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const first = (await list()).body.data.items[0];
  expect(first).toEqual({ id, ...input, image: null });
  for (const field of ['createdBy', 'updatedBy', 'imageData', 'imageVersion', 'imageMimeType', '__v', 'hasUploadedImage']) expect(first).not.toHaveProperty(field);
  await adminCall('patch', `/${id}`).send({ title: 'Sopa atualizada', seasonal: true });
  expect((await list()).body.data.items[0]).toMatchObject({ title: 'Sopa atualizada', seasonal: true });
  await adminCall('delete', `/${id}`);
  expect((await list()).body.data.items).toEqual([]);
});

it('filtra antes de paginar e permite categorias sem distinguir maiúsculas', async () => {
  await Recipe.insertMany(Array.from({ length: 26 }, (_, index) => ({ ...input,
    title: `Receita ${index}`, preparationMinutes: index < 2 ? 30 : 45,
    categories: index < 2 ? ['sopas'] : ['Doces'],
    createdBy: admin.id, updatedBy: admin.id, createdAt: new Date(2026, 0, index + 1)
  })));
  const first = (await list()).body.data;
  const second = (await list('?page=2')).body.data;
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(6);
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(26);
  expect(first.pagination).toEqual({ page: 1, limit: 20, total: 26, pages: 2 });
  expect((await list('?quick=true&category=Sopas')).body.data.items.map(item => item.title)).toEqual(['Receita 1', 'Receita 0']);
  expect((await list('?category=Doces&limit=1')).body.data.pagination).toMatchObject({ total: 24, pages: 24 });
  expect((await list('?category=%2E%2A')).body.data.items).toEqual([]);
});

it('lê o detalhe atual sem credenciais e trata receitas eliminadas ou identificadores inválidos', async () => {
  const created = await adminCall('post').send(input);
  const id = created.body.data.id;
  const detail = () => request(app).get(`/api/v1/recipes/${id}`);
  const first = await detail();
  expect(first.status).toBe(200);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body.data).toEqual({ id, ...input, image: null });
  await adminCall('patch', `/${id}`).send({ steps: ['Preparar os legumes.', 'Cozer e triturar.'], image: 'https://example.com/sopa.jpg' });
  expect((await detail()).body.data).toMatchObject({ steps: ['Preparar os legumes.', 'Cozer e triturar.'], image: 'https://example.com/sopa.jpg' });
  await adminCall('delete', `/${id}`);
  const removed = await detail();
  expect(removed.status).toBe(404);
  expect(removed.body.error.code).toBe('RECIPE_NOT_FOUND');
  expect((await request(app).get('/api/v1/recipes/invalid')).status).toBe(422);
});

it.each(['page=0', 'limit=101', 'quick=1', 'category[$ne]=x', 'createdBy=x', 'category='])('rejeita parâmetros inválidos: %s', async query => {
  expect((await list(`?${query}`)).status).toBe(422);
});

it('entrega a foto carregada sem cookies administrativos e respeita a versão da imagem', async () => {
  const photo = color => sharp({ create: { width: 72, height: 48, channels: 3, background: color } }).png().toBuffer();
  const created = await adminCall('post').field('data', JSON.stringify(input)).attach('image', await photo('#aabb00'), 'sopa.png');
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const recipe = (await list()).body.data.items[0];
  expect((await request(app).get(`/api/v1/recipes/${id}`)).body.data.image).toBe(recipe.image);
  expect(recipe.image).toMatch(new RegExp(`^/api/v1/recipes/${id}/image\\?v=`));
  expect(recipe.image).not.toContain('/admin/');
  const image = await request(app).get(recipe.image);
  expect(image.status).toBe(200);
  expect(image.headers['content-type']).toContain('image/webp');
  expect(await sharp(image.body).metadata()).toMatchObject({ width: 72, height: 48, format: 'webp' });
  expect(image.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  expect((await request(app).get(recipe.image).set('If-None-Match', image.headers.etag)).status).toBe(304);
  expect((await request(app).get(created.body.data.image)).status).toBe(403);
  await adminCall('patch', `/${id}`).field('data', '{}').attach('image', await photo('#00ffaa'), 'nova.png');
  const replacement = (await list()).body.data.items[0].image;
  expect(replacement).not.toBe(recipe.image);
  expect((await request(app).get(recipe.image)).status).toBe(404);
  expect((await request(app).get(replacement)).status).toBe(200);
  await adminCall('delete', `/${id}`);
  const removed = await request(app).get(replacement);
  expect(removed.status).toBe(404);
  expect(removed.headers['cache-control']).toBe('no-store');
});

it('mantém imagens externas e devolve 404 para fotografias ausentes ou removidas', async () => {
  const created = await adminCall('post').send({ ...input, image: 'https://example.com/sopa.jpg' });
  const id = created.body.data.id;
  expect((await list()).body.data.items[0].image).toBe('https://example.com/sopa.jpg');
  expect((await request(app).get(`/api/v1/recipes/${id}/image`)).status).toBe(404);
  expect((await request(app).get('/api/v1/recipes/invalid/image')).status).toBe(422);
  expect((await request(app).get(`/api/v1/recipes/${id}/image?v=invalid`)).status).toBe(422);
});

it('não permite criar, alterar ou eliminar pela API pública', async () => {
  const created = await adminCall('post').send(input);
  const id = created.body.data.id;
  for (const [method, path] of [['post', ''], ['put', `/${id}`], ['patch', `/${id}`], ['delete', `/${id}`]]) {
    expect((await request(app)[method](`/api/v1/recipes${path}`).send(input)).status).toBe(404);
  }
  expect((await request(app).patch(`/api/v1/admin/recipes/${id}`).set(headers).send({ title: 'Sem autorização' })).status).toBe(401);
  expect((await list()).body.data.items[0].title).toBe(input.title);
});
