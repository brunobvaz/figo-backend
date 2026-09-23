import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../src/app.js';
import { Admin } from '../src/models/Admin.js';
import { AdminSession } from '../src/models/AdminSession.js';
import { Event } from '../src/models/Event.js';
import { eventLocationInput, eventLocation, seedEventLocations } from './fixtures/eventLocations.js';

let mongo, admin, cookie, passwordHash;
const headers = { Origin: 'http://localhost:5173', 'X-Figo-Backoffice': '1' };
const input = { title: 'Feira do backoffice', description: 'Produtos locais e encontros com produtores.', type: 'Feira',
  date: '2026-09-27', startTime: '09:00', endTime: '18:00', location: 'Chaves', distanceKm: 1.4, free: true, ...eventLocationInput };
const adminCall = (method, path = '') => request(app)[method](`/api/v1/admin/events${path}`).set(headers).set('Cookie', cookie);
const list = query => request(app).get(`/api/v1/events${query || ''}`);
const detail = id => request(app).get(`/api/v1/events/${id}`);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Admin.init(), AdminSession.init(), Event.init()]);
  passwordHash = await argon2.hash('Public-event-test-2026');
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await seedEventLocations();
  await Promise.all([Event, Admin, AdminSession].map(model => model.deleteMany({})));
  admin = await Admin.create({ name: 'Editor de eventos', email: 'editor@figo.test', passwordHash });
  const login = await request(app).post('/api/v1/admin/auth/login').set(headers).send({ email: admin.email, password: 'Public-event-test-2026' });
  cookie = login.headers['set-cookie'][0].split(';')[0];
});

it('devolve a base vazia sem eventos de demonstração', async () => {
  const response = await list();
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.data).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
});

it('reflete criação, edição e eliminação do backoffice na lista e detalhe públicos', async () => {
  const created = await adminCall('post').send(input);
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const { municipalityCode, parishCode, ...editorialFields } = input;
  const expected = { id, ...editorialFields, ...eventLocation(input.location), image: null };
  expect((await list()).body.data.items).toEqual([expected]);
  const first = await detail(id);
  expect(first.status).toBe(200);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body.data).toEqual(expected);
  for (const field of ['createdBy', 'updatedBy', 'imageData', 'imageVersion', 'imageMimeType', '__v', 'hasUploadedImage']) expect(first.body.data).not.toHaveProperty(field);
  await adminCall('patch', `/${id}`).send({ title: 'Feira atualizada', date: '2026-10-04', description: 'Nova descrição.' });
  for (const event of [(await list()).body.data.items[0], (await detail(id)).body.data])
    expect(event).toMatchObject({ title: 'Feira atualizada', date: '2026-10-04', description: 'Nova descrição.' });
  await adminCall('delete', `/${id}`);
  expect((await list()).body.data.items).toEqual([]);
  const removed = await detail(id);
  expect(removed.status).toBe(404);
  expect(removed.body.error.code).toBe('EVENT_NOT_FOUND');
  expect((await detail('invalid')).status).toBe(422);
});

it('ordena por data/hora/id, pagina todos os resultados e filtra antes de paginar', async () => {
  const events = await Event.insertMany(Array.from({ length: 26 }, (_, index) => ({ ...input,
    title: `Evento ${index}`, date: index < 2 ? '2026-10-04' : '2026-09-27', startTime: index % 2 ? '10:00' : '09:00',
    type: index < 2 ? 'Mercado' : 'Feira', free: index % 2 === 0, createdBy: admin.id, updatedBy: admin.id
  })));
  const sortedIds = events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id)).map(event => event.id);
  const first = (await list()).body.data;
  const second = (await list('?page=2')).body.data;
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(6);
  expect([...first.items, ...second.items].map(item => item.id)).toEqual(sortedIds);
  expect(first.pagination).toEqual({ page: 1, limit: 20, total: 26, pages: 2 });
  expect((await list('?type=Mercado&limit=1')).body.data).toMatchObject({ items: [{ title: 'Evento 0' }], pagination: { total: 2, pages: 2 } });
  expect((await list('?from=2026-10-04&to=2026-10-04&free=false')).body.data.items.map(item => item.title)).toEqual(['Evento 1']);
  expect((await list('?to=2026-09-26')).body.data.items).toEqual([]);
  expect((await list('?from=2026-10-05')).body.data.items).toEqual([]);
  expect(first.items[0]).toMatchObject({ address: null, geo: null, locationSource: null });
});

it.each(['page=0', 'page=1.5', 'limit=101', 'type=Outro', 'free=1', 'from=2026-02-30', 'to=2026-09-01&from=2026-09-02', 'createdBy=x', 'date[$ne]=x'])('rejeita parâmetros inválidos: %s', async query => {
  expect((await list(`?${query}`)).status).toBe(422);
});

it('entrega fotografias públicas versionadas e deixa de servir versões substituídas ou eliminadas', async () => {
  const photo = color => sharp({ create: { width: 72, height: 48, channels: 3, background: color } }).png().toBuffer();
  const created = await adminCall('post').field('data', JSON.stringify(input)).attach('image', await photo('#aabb00'), 'feira.png');
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const event = (await list()).body.data.items[0];
  expect((await detail(id)).body.data.image).toBe(event.image);
  expect(event.image).toMatch(new RegExp(`^/api/v1/events/${id}/image\\?v=`));
  expect(event.image).not.toContain('/admin/');
  const image = await request(app).get(event.image);
  expect(image.status).toBe(200);
  expect(image.headers['content-type']).toContain('image/webp');
  expect(await sharp(image.body).metadata()).toMatchObject({ width: 1080, height: 1350, format: 'webp' });
  expect(image.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  expect((await request(app).get(event.image).set('If-None-Match', image.headers.etag)).status).toBe(304);
  expect((await request(app).get(created.body.data.image)).status).toBe(403);
  await adminCall('patch', `/${id}`).field('data', '{}').attach('image', await photo('#00ffaa'), 'nova.png');
  const replacement = (await detail(id)).body.data.image;
  expect(replacement).not.toBe(event.image);
  expect((await request(app).get(event.image)).status).toBe(404);
  expect((await request(app).get(replacement)).status).toBe(200);
  await adminCall('patch', `/${id}`).send({ image: null });
  expect((await detail(id)).body.data.image).toBeNull();
  expect((await request(app).get(replacement)).status).toBe(404);
  await adminCall('delete', `/${id}`);
  const removed = await request(app).get(replacement);
  expect(removed.status).toBe(404);
  expect(removed.headers['cache-control']).toBe('no-store');
});

it('preserva imagens externas e campos opcionais sem inventar distâncias ou horas', async () => {
  const created = await adminCall('post').send({ ...input, image: 'https://example.com/feira.jpg', distanceKm: null, endTime: null, free: false });
  const id = created.body.data.id;
  expect((await detail(id)).body.data).toMatchObject({ image: 'https://example.com/feira.jpg', distanceKm: null, endTime: null, free: false });
  expect((await request(app).get(`/api/v1/events/${id}/image`)).status).toBe(404);
  expect((await request(app).get('/api/v1/events/invalid/image')).status).toBe(422);
  expect((await request(app).get(`/api/v1/events/${id}/image?v=invalid`)).status).toBe(422);
});

it('mantém a escrita exclusiva do backoffice autenticado', async () => {
  const created = await adminCall('post').send(input);
  const id = created.body.data.id;
  for (const [method, path] of [['post', ''], ['put', `/${id}`], ['patch', `/${id}`], ['delete', `/${id}`]])
    expect((await request(app)[method](`/api/v1/events${path}`).send(input)).status).toBe(404);
  expect((await request(app).patch(`/api/v1/admin/events/${id}`).set(headers).send({ title: 'Sem autorização' })).status).toBe(401);
  expect((await detail(id)).body.data.title).toBe(input.title);
});
