import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import { app } from '../src/app.js';
import { Admin } from '../src/models/Admin.js';
import { AdminSession } from '../src/models/AdminSession.js';
import { Event } from '../src/models/Event.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { tokenService } from '../src/services/tokenService.js';
import mockEvents from '../../mobile/src/data/mockEvents.js';

let mongo, passwordHash, admin, cookie;
const password = 'Recipe-test-only-2026';
const headers = { Origin: 'http://localhost:5173', 'X-Figo-Backoffice': '1' };
const input = { title: 'Feira da horta', description: 'Encontro com produtores locais.', type: 'Feira', date: '2028-02-29', startTime: '09:00', endTime: '18:00', location: 'Chaves', distanceKm: 0, free: true };
const endpoint = '/api/v1/admin/events';
const call = (method, path = '') => request(app)[method](`${endpoint}${path}`).set(headers).set('Cookie', cookie);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Admin.init(), AdminSession.init(), Event.init(), User.init(), Session.init()]);
  passwordHash = await argon2.hash(password);
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Admin, AdminSession, Event, User, Session].map(model => model.deleteMany({})));
  admin = await Admin.create({ name: 'Editor Figo', email: 'recipes@figo.test', passwordHash });
  const login = await request(app).post('/api/v1/admin/auth/login').set(headers).send({ email: admin.email, password });
  expect(login.status).toBe(200);
  cookie = login.headers['set-cookie'][0].split(';')[0];
});

it('cria, consulta, edita e elimina eventos com datas locais e auditoria administrativa', async () => {
  const created = await call('post').send({ ...input, title: ' Feira da horta ' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const event = created.body.data;
  expect(event).toMatchObject({ ...input, image: null, hasUploadedImage: false });
  expect(event).not.toHaveProperty('createdBy');
  expect(event).not.toHaveProperty('imageData');
  expect(event).not.toHaveProperty('__v');
  expect(Event.collection.name).toBe('events');
  const stored = await Event.findById(event.id);
  expect(stored.createdBy.toString()).toBe(admin.id);
  expect(stored.date).toBe('2028-02-29');
  expect((await call('get', `/${event.id}`)).body.data).toEqual(event);
  const updated = await call('patch', `/${event.id}`).send({ title: 'Mercado da horta', type: 'Mercado', free: false });
  expect(updated.status).toBe(200);
  expect(updated.body.data).toMatchObject({ title: 'Mercado da horta', type: 'Mercado', free: false, distanceKm: 0, date: input.date, endTime: '18:00' });
  const cleared = await call('patch', `/${event.id}`).send({ endTime: null, distanceKm: null, description: '' });
  expect(cleared.body.data).toMatchObject({ endTime: null, distanceKm: null, description: '' });
  expect((await call('delete', `/${event.id}`)).status).toBe(200);
  expect(await Event.findById(event.id)).toBeNull();
  for (const method of ['get', 'patch', 'delete']) {
    const req = call(method, `/${event.id}`);
    expect((await (method === 'patch' ? req.send({ title: 'Outro evento' }) : req)).status).toBe(404);
  }
});

it('aceita os campos dos mocks sem importar automaticamente eventos', async () => {
  expect((await call('get')).body.data.items).toEqual([]);
  for (const { id, ...event } of mockEvents) {
    const response = await call('post').send(event);
    expect(response.status, id).toBe(201);
    expect(response.body.data).toMatchObject(event);
  }
  expect(await Event.countDocuments()).toBe(mockEvents.length);
});

it.each([
  ['title', ' '], ['title', 'A'.repeat(121)], ['type', 'Receita'], ['location', ''],
  ['date', '2026-02-29'], ['date', '2026-04-31'], ['date', '2026-13-01'], ['date', '2026-09-21T00:00:00Z'],
  ['startTime', '24:00'], ['startTime', '9:00'], ['endTime', '08:00'], ['endTime', '09:00'],
  ['distanceKm', -1], ['distanceKm', '12'], ['distanceKm', 20001], ['free', 'true'],
  ['description', 'a'.repeat(2001)], ['image', 'http://example.com/a.png'], ['image', 'https://user:secret@example.com/a.png'],
  ['createdBy', '000000000000000000000001'], ['ingredients', ['Batata']]
])('rejeita %s inválido sem gravar (%j)', async (field, value) => {
  const response = await call('post').send({ ...input, [field]: value });
  expect(response.status).toBe(422);
  expect(await Event.countDocuments()).toBe(0);
});

it('valida o intervalo de horas contra os valores existentes em edições parciais', async () => {
  const id = (await call('post').send(input)).body.data.id;
  for (const change of [{ startTime: '19:00' }, { endTime: '08:00' }]) {
    const response = await call('patch', `/${id}`).send(change);
    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('endTime');
  }
  expect((await call('get', `/${id}`)).body.data).toMatchObject({ startTime: '09:00', endTime: '18:00' });
  expect((await call('patch', `/${id}`).send({ startTime: '19:00', endTime: null })).status).toBe(200);
});

it('filtra por tipo, período inclusivo, entrada e pesquisa literal; pagina por data e hora', async () => {
  await Event.insertMany([
    { ...input, title: 'Feira [especial]', date: '2026-09-20', createdBy: admin.id, updatedBy: admin.id },
    { ...input, title: 'Mercado', type: 'Mercado', date: '2026-09-20', startTime: '08:00', createdBy: admin.id, updatedBy: admin.id },
    { ...input, title: 'Encontro', type: 'Evento', date: '2026-10-01', free: false, location: 'Boticas', createdBy: admin.id, updatedBy: admin.id }
  ]);
  const list = (await call('get', '?limit=2')).body.data;
  expect(list.items.map(item => item.title)).toEqual(['Mercado', 'Feira [especial]']);
  expect(list.pagination).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
  expect((await call('get', '?limit=2&page=2')).body.data.items[0].title).toBe('Encontro');
  expect((await call('get', '?from=2026-09-20&to=2026-09-20&type=Feira&free=true')).body.data.items.map(item => item.title)).toEqual(['Feira [especial]']);
  expect((await call('get', '?free=false')).body.data.items.map(item => item.title)).toEqual(['Encontro']);
  expect((await call('get', '?search=%5Bespecial%5D')).body.data.pagination.total).toBe(1);
  expect((await call('get', '?search=Boticas')).body.data.pagination.total).toBe(1);
  expect((await call('get', '?search=produtores')).body.data.pagination.total).toBe(3);
  for (const query of ['from=2026-02-30', 'from=2026-10-01&to=2026-09-01', 'type=Sopa', 'free=1', 'page=0', 'limit=101', 'search[$ne]=x'])
    expect((await call('get', `?${query}`)).status).toBe(422);
  expect((await call('get', '/invalid')).status).toBe(422);
  expect((await call('patch', `/${list.items[0].id}`).send({})).status).toBe(422);
});

const photo = color => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer();

it('guarda a foto no MongoDB, preserva em edições e permite substituir, limpar e eliminar', async () => {
  const created = await call('post').field('data', JSON.stringify(input)).attach('image', await photo('#ffaa00'), 'evento.png');
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const { id, image } = created.body.data;
  expect(created.body.data.hasUploadedImage).toBe(true);
  const delivered = await call('get', `/${id}/image`);
  expect(delivered.headers['cache-control']).toBe('no-store');
  expect(await sharp(delivered.body).metadata()).toMatchObject({ format: 'webp', width: 64, height: 48 });
  expect((await Event.findById(id)).imageData).toBeUndefined();
  const edited = await call('patch', `/${id}`).send({ title: 'Feira com fotografia' });
  expect(edited.body.data.image).toBe(image);
  expect((await call('get', `/${id}/image`)).body.equals(delivered.body)).toBe(true);
  const invalid = await call('patch', `/${id}`).field('data', JSON.stringify({ title: 'Não gravar' })).attach('image', Buffer.from('not an image'), 'falsa.png');
  expect(invalid.status).toBe(422);
  expect((await call('get', `/${id}`)).body.data.title).toBe('Feira com fotografia');
  const replacement = await call('patch', `/${id}`).field('data', '{}').attach('image', await photo('#00aa00'), 'outra.png');
  expect(replacement.status).toBe(200);
  expect(replacement.body.data.image).not.toBe(image);
  const external = await call('patch', `/${id}`).send({ image: 'https://example.com/evento.png' });
  expect(external.body.data).toMatchObject({ hasUploadedImage: false, image: 'https://example.com/evento.png' });
  expect((await Event.findById(id).select('+imageData')).imageData).toBeNull();
  expect((await call('get', `/${id}/image`)).status).toBe(404);
  expect((await call('patch', `/${id}`).send({ image: null })).body.data.image).toBeNull();
  await call('patch', `/${id}`).field('data', '{}').attach('image', await photo('#000000'), 'foto.png');
  await call('delete', `/${id}`);
  expect((await call('get', `/${id}/image`)).status).toBe(404);
  expect(await Event.findById(id)).toBeNull();
});

it('recusa uploads malformados e ficheiros excessivos sem criar eventos', async () => {
  const png = await photo('#fff');
  const requests = [
    call('post').field('data', JSON.stringify(input)).attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'grande.png'),
    call('post').field('data', JSON.stringify(input)).attach('image', png, 'a.png').attach('image', png, 'b.png'),
    call('post').field('data', JSON.stringify(input)).attach('image', Buffer.from('<svg/>'), { filename: 'svg.png', contentType: 'image/png' }),
    call('post').field('data', 'invalid').attach('image', png, 'a.png'),
    call('post').field('data', JSON.stringify({ ...input, image: 'https://example.com/photo.jpg' })).attach('image', png, 'a.png')
  ];
  for (const req of requests) expect((await req).status).toBe(422);
  expect(await Event.countDocuments()).toBe(0);
});

it('exige administrador, origem e header em todas as rotas, sem endpoint público', async () => {
  const user = await User.create({ name: 'Utilizador', email: 'user@figo.test', passwordHash, termsAcceptedAt: new Date() });
  const session = await Session.create({ userId: user._id, refreshTokenHash: 'test', expiresAt: new Date(Date.now() + 60000) });
  const token = tokenService.generateAccessToken(user, session.id);
  const id = new mongoose.Types.ObjectId().toString();
  for (const [method, path] of [['get', ''], ['post', ''], ['get', `/${id}`], ['get', `/${id}/image`], ['patch', `/${id}`], ['delete', `/${id}`]]) {
    expect((await request(app)[method](`${endpoint}${path}`).set(headers).send()).status).toBe(401);
    expect((await request(app)[method](`${endpoint}${path}`).set(headers).auth(token, { type: 'bearer' }).send()).status).toBe(401);
    expect((await request(app)[method](`${endpoint}${path}`).set('Cookie', cookie).send()).status).toBe(403);
    expect((await request(app)[method](`${endpoint}${path}`).set({ ...headers, Origin: 'https://evil.test' }).set('Cookie', cookie).send()).status).toBe(403);
  }
  expect((await request(app).post(endpoint).set(headers).field('data', JSON.stringify(input)).attach('image', await photo('#fff'), 'foto.png')).status).toBe(401);
  expect((await request(app).get('/api/v1/events')).status).toBe(404);
  await Admin.updateOne({ _id: admin.id }, { $set: { status: 'disabled' } });
  expect((await call('get')).status).toBe(401);
});
