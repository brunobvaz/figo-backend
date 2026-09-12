import { migrateOptionalPhone } from '../scripts/migrate-optional-phone.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { OneTimeToken } from '../src/models/OneTimeToken.js';
import { EmailOtp } from '../src/models/EmailOtp.js';
import { hashOtp, hashToken } from '../src/utils/crypto.js';

let mongo;
const productLocation = { municipalityCode: '0407', parishCode: '040701', locality: 'Mirandela', latitude: 41.48, longitude: -7.18, locationSource: 'parish' };

const validRegistration = {
  firstName: 'Manuel', lastName: 'Silva', email: 'manuel@email.pt', phone: '912345678', password: 'Password!123',
  roles: ['buyer'], location: { city: 'Mirandela', postalCode: '5370-000' }, confirmAdult: true, acceptTerms: true, marketingConsent: false
};

const register = (overrides = {}) => request(app).post('/api/v1/auth/register').send({ ...validRegistration, ...overrides });
const login = (overrides = {}) => request(app).post('/api/v1/auth/login').send({ email: validRegistration.email, password: validRegistration.password, ...overrides });
const verifyUserInDatabase = () => User.updateOne({ email: validRegistration.email }, { emailVerified: true });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  const db = mongoose.connection.db;
  await Promise.all(['referenceDatasets', 'municipalities', 'parishes'].map(name => db.collection(name).deleteMany({})));
  await db.collection('referenceDatasets').insertOne({ _id: 'caop', activeVersion: 'CAOP2025' });
  await db.collection('municipalities').insertOne({ code: '0407', name: 'Mirandela', version: 'CAOP2025' });
  await db.collection('parishes').insertOne({ code: '040701', municipalityCode: '0407', name: 'Abambres', version: 'CAOP2025', latitude: 41.48, longitude: -7.18 });
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe('POST /auth/register', () => {
  it('cria um utilizador sem expor o hash', async () => {
    const response = await register();
    expect(response.status).toBe(201);
    expect(response.body.data.user).toMatchObject({ name: 'Manuel Silva', firstName: 'Manuel', lastName: 'Silva', email: validRegistration.email, phone: '+351912345678', roles: ['buyer', 'seller'] });
    expect(response.body.data.verification).toMatchObject({ email: validRegistration.email });
    expect(response.body.data.verification.devCode).toBeUndefined();
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect((await User.findOne({ email: validRegistration.email }).select('+passwordHash')).passwordHash).not.toBe(validRegistration.password);
  });
  it('rejeita email duplicado já verificado', async () => { await register(); await verifyUserInDatabase(); expect((await register({ phone: '913345678' })).status).toBe(409); });
  it('permite repetir o registo ainda não verificado e gera novo desafio', async () => { await register(); const response = await register(); expect(response.status).toBe(201); expect(response.body.data.verification.challengeId).toBeTruthy(); expect(await User.countDocuments()).toBe(1); });
  it('rejeita telefone duplicado', async () => { await register(); expect((await register({ email: 'outro@email.pt' })).status).toBe(409); });
  it.each([undefined, 'buy', 'sell', 'both'])('aceita o novo registo sem telefone com intenção %s', async usageIntent => {
    const response = await register({ phone: undefined, roles: undefined, usageIntent,
      location: { municipalityCode: '0407', parishCode: '040701' } });
    expect(response.status).toBe(201);
    expect(response.body.data.user.roles).toEqual(['buyer', 'seller']);
    expect(response.body.data.user.phone).toBeUndefined();
    const user = await User.findOne();
    expect(user.usageIntent).toBe(usageIntent);
    expect(user.location.toObject()).toMatchObject({ municipalityCode: '0407', municipality: 'Mirandela',
      parishCode: '040701', parish: 'Abambres', geo: { type: 'Point', coordinates: [-7.18, 41.48] } });
    await verifyUserInDatabase();
    const auth = (await login()).body.data;
    const product = { title: 'Tomates', description: 'Tomates frescos da horta.', price: 2,
      unit: '€/kg', category: 'Legumes', ...productLocation };
    expect((await request(app).post('/api/v1/products').set('Authorization', `Bearer ${auth.accessToken}`).send(product)).status).toBe(201);
  });
  it('aceita várias contas sem telefone', async () => {
    expect((await register({ phone: undefined })).status).toBe(201);
    expect((await register({ phone: undefined, email: 'segunda@email.pt' })).status).toBe(201);
  });
  it('preserva o telefone antigo ao repetir registo sem telefone', async () => {
    await register();
    expect((await register({ phone: undefined })).status).toBe(201);
    expect((await User.findOne()).phone).toBe('+351912345678');
  });
  it('rejeita intenção inválida e localização incompleta ou incompatível', async () => {
    expect((await register({ usageIntent: 'admin' })).status).toBe(422);
    expect((await register({ location: { municipalityCode: '0407' } })).status).toBe(422);
    expect((await register({ location: { municipalityCode: '0407', parishCode: '999901' } })).status).toBe(422);
    expect((await register({ acceptTerms: false })).status).toBe(422);
  });
  it('rejeita password fraca', async () => { expect((await register({ password: 'fraca' })).status).toBe(422); });
  it('não permite admin no endpoint público', async () => { expect((await register({ roles: ['admin'] })).status).toBe(422); });
  it('exige confirmação de maioridade', async () => { expect((await register({ confirmAdult: false })).status).toBe(422); });
});

describe('verificação de email por OTP', () => {
  it('verifica o email e cria uma sessão', async () => {
    const registration = await register({ phone: undefined, roles: undefined, location: { municipalityCode: '0407', parishCode: '040701' } });
    const { challengeId } = registration.body.data.verification;
    const code = '384921';
    await EmailOtp.updateOne({ _id: challengeId }, { codeHash: hashOtp(challengeId, code, process.env.EMAIL_OTP_SECRET) });
    const response = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });
    expect(response.status).toBe(200);
    expect(response.body.data.user.emailVerified).toBe(true);
    expect(response.body.data).toHaveProperty('accessToken');
  });

  it('rejeita um código incorreto e conta a tentativa', async () => {
    const registration = await register({ phone: undefined, roles: undefined, location: { municipalityCode: '0407', parishCode: '040701' } });
    const { challengeId } = registration.body.data.verification;
    expect((await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code: '000000' })).status).toBe(400);
    expect((await EmailOtp.findById(challengeId)).attempts).toBe(1);
  });
});

describe('POST /auth/login', () => {
  it('autentica e cria tokens', async () => { await register(); await verifyUserInDatabase(); const response = await login(); expect(response.status).toBe(200); expect(response.body.data).toHaveProperty('accessToken'); expect(response.body.data).toHaveProperty('refreshToken'); });
  it('rejeita password errada sem revelar o campo incorreto', async () => { await register(); const response = await login({ password: 'errada' }); expect(response.status).toBe(401); expect(response.body.error.message).toBe('Email ou palavra-passe inválidos.'); });
  it('rejeita utilizador inexistente com a mesma mensagem', async () => { const response = await login(); expect(response.status).toBe(401); expect(response.body.error.message).toBe('Email ou palavra-passe inválidos.'); });
  it('rejeita utilizador suspenso', async () => { await register(); await User.updateOne({}, { status: 'suspended' }); expect((await login()).status).toBe(403); });
});

describe('middleware authenticate', () => {
  it('aceita token válido', async () => { await register(); await verifyUserInDatabase(); const auth = (await login()).body.data; expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${auth.accessToken}`)).status).toBe(200); });
  it('rejeita pedido sem token', async () => { expect((await request(app).get('/api/v1/auth/me')).status).toBe(401); });
  it('rejeita token expirado', async () => { const token = jwt.sign({ sub: new mongoose.Types.ObjectId(), sid: new mongoose.Types.ObjectId() }, process.env.JWT_ACCESS_SECRET, { expiresIn: -1 }); const response = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`); expect(response.status).toBe(401); expect(response.body.error.code).toBe('AUTH_TOKEN_EXPIRED'); });
  it('rejeita token inválido', async () => { expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer inválido')).status).toBe(401); });
});

describe('fotografia de perfil', () => {
  it('rejeita um avatar vazio sem substituir a fotografia anterior', async () => {
    await register();
    await verifyUserInDatabase();
    await User.updateOne({}, { avatarFilename: 'anterior.jpg' });
    const auth = (await login()).body.data;
    const directory = path.join(process.cwd(), 'uploads', 'avatars');
    const before = await fs.readdir(directory);
    const response = await request(app).post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .attach('avatar', Buffer.alloc(0), { filename: 'vazia.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('EMPTY_AVATAR');
    expect((await User.findOne()).avatarFilename).toBe('anterior.jpg');
    expect(await fs.readdir(directory)).toEqual(before);
  });
  it('carrega uma imagem e guarda apenas o nome do ficheiro', async () => {
    await register();
    await verifyUserInDatabase();
    const auth = (await login()).body.data;
    const response = await request(app)
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .attach('avatar', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'perfil.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(200);
    expect(response.body.data.avatarFilename).toMatch(/^[0-9a-f-]+\.jpg$/);
    const stored = await User.findOne();
    expect(stored.avatarFilename).toBe(response.body.data.avatarFilename);
    expect(stored.toObject()).not.toHaveProperty('avatar');
    await fs.unlink(path.join(process.cwd(), 'uploads', 'avatars', response.body.data.avatarFilename));
  });

  it('rejeita ficheiros que não são imagens permitidas', async () => {
    await register();
    await verifyUserInDatabase();
    const auth = (await login()).body.data;
    const response = await request(app).post('/api/v1/users/me/avatar').set('Authorization', `Bearer ${auth.accessToken}`).attach('avatar', Buffer.from('texto'), { filename: 'perfil.txt', contentType: 'text/plain' });
    expect(response.status).toBe(422);
  });
});

describe('refresh e logout', () => {
  it('faz rotação e invalida o token anterior', async () => { await register(); await verifyUserInDatabase(); const first = (await login()).body.data; const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }); expect(rotated.status).toBe(200); expect(rotated.body.data.refreshToken).not.toBe(first.refreshToken); expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken })).status).toBe(401); });
  it('rejeita refresh expirado', async () => { await register(); await verifyUserInDatabase(); const auth = (await login()).body.data; await Session.updateOne({}, { expiresAt: new Date(0) }); expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: auth.refreshToken })).status).toBe(401); });
  it('rejeita refresh revogado', async () => { await register(); await verifyUserInDatabase(); const auth = (await login()).body.data; await Session.updateOne({}, { revokedAt: new Date() }); expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: auth.refreshToken })).status).toBe(401); });
  it('logout invalida a sessão', async () => { await register(); await verifyUserInDatabase(); const auth = (await login()).body.data; expect((await request(app).post('/api/v1/auth/logout').send({ refreshToken: auth.refreshToken })).status).toBe(200); expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${auth.accessToken}`)).status).toBe(401); });
});

describe('password reset', () => {
  async function seedResetToken({ expired = false, used = false } = {}) {
    await register(); const user = await User.findOne(); const token = 'a'.repeat(64);
    await OneTimeToken.create({ userId: user._id, tokenHash: hashToken(token), type: 'passwordReset', expiresAt: expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 60000), usedAt: used ? new Date() : null });
    return token;
  }
  it('aceita token válido e revoga sessões', async () => { const token = await seedResetToken(); await verifyUserInDatabase(); await login(); const response = await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'NovaPassword!123' }); expect(response.status).toBe(200); expect(await Session.countDocuments({ revokedAt: null })).toBe(0); });
  it('rejeita token expirado', async () => { const token = await seedResetToken({ expired: true }); expect((await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'NovaPassword!123' })).status).toBe(400); });
  it('rejeita token já utilizado', async () => { const token = await seedResetToken({ used: true }); expect((await request(app).post('/api/v1/auth/reset-password').send({ token, newPassword: 'NovaPassword!123' })).status).toBe(400); });
});

describe('produtos', () => {
  const product = { title: 'Tomate coração de boi', description: 'Tomate fresco colhido esta manhã.', price: 2.6, unit: '€/kg', category: 'Legumes', ...productLocation, image: 'https://example.com/tomate.jpg' };
  it('rejeita uma imagem de produto vazia', async () => {
    await register({ roles: ['seller'] });
    await verifyUserInDatabase();
    const auth = (await login()).body.data;
    let upload = request(app).post('/api/v1/products').set('Authorization', `Bearer ${auth.accessToken}`);
    Object.entries(product).filter(([key]) => key !== 'image').forEach(([key, value]) => { upload = upload.field(key, String(value)); });
    const response = await upload.attach('image', Buffer.alloc(0), { filename: 'vazia.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('EMPTY_PRODUCT_IMAGE');
    expect((await request(app).get('/api/v1/products')).body.data.items).toEqual([]);
  });

  it('permite ao vendedor criar, editar, listar e remover um produto', async () => {
    await register({ roles: ['seller'] });
    await verifyUserInDatabase();
    const auth = (await login()).body.data;
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    let createRequest = request(app).post('/api/v1/products').set(headers);
    Object.entries(product).filter(([key]) => key !== 'image').forEach(([key, value]) => { createRequest = createRequest.field(key, String(value)); });
    const created = await createRequest.attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'tomate.jpg', contentType: 'image/jpeg' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: product.title, seller: { id: auth.user.id } });
    expect(created.body.data.imageFilename).toMatch(/\.jpg$/);
    const id = created.body.data.id;
    const updated = await request(app).patch(`/api/v1/products/${id}`).set(headers).send({ title: 'Tomate biológico' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('Tomate biológico');
    const listed = await request(app).get('/api/v1/products');
    expect(listed.status).toBe(200);
    expect(listed.body.data.items).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/products/${id}`).set(headers)).status).toBe(204);
    expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404);
  });

  it('permite publicar sem escolher perfil de vendedor', async () => {
    await register();
    await verifyUserInDatabase();
    const auth = (await login()).body.data;
    expect((await request(app).post('/api/v1/products').set('Authorization', `Bearer ${auth.accessToken}`).send(product)).status).toBe(201);
  });
});

describe('chat entre utilizadores', () => {
  let buyerAuth, sellerAuth, outsiderAuth, productId;
  const headers = (auth) => ({ Authorization: `Bearer ${auth.accessToken}` });
  const open = () => request(app).post('/api/v1/conversations').set(headers(buyerAuth)).send({ productId });
  const send = (id, auth, text, clientId = 'message-test-001') => request(app).post(`/api/v1/conversations/${id}/messages`).set(headers(auth)).send({ text, clientId });
  beforeEach(async () => {
    await register();
    await register({ email: 'seller@email.pt', phone: '913345678', roles: ['seller'] });
    await register({ email: 'outsider@email.pt', phone: '914345678' });
    await User.updateMany({}, { emailVerified: true });
    buyerAuth = (await login()).body.data;
    sellerAuth = (await login({ email: 'seller@email.pt' })).body.data;
    outsiderAuth = (await login({ email: 'outsider@email.pt' })).body.data;
    const product = await request(app).post('/api/v1/products').set(headers(sellerAuth)).send({ title: 'Tomates', description: 'Tomates frescos da horta.', price: 2, unit: '€/kg', category: 'Legumes', ...productLocation });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });
  it('mantém conversas distintas para produtos diferentes entre as mesmas pessoas', async () => {
    const first = (await open()).body.data;
    const created = await request(app).post('/api/v1/products').set(headers(sellerAuth)).send({ title: 'Mel caseiro', description: 'Mel fresco da produção local.', price: 7.4, unit: '€/frasco', category: 'Mel', ...productLocation });
    expect(created.status).toBe(201);
    const second = await request(app).post('/api/v1/conversations').set(headers(buyerAuth)).send({ productId: created.body.data.id });
    expect(second.body.data.id).not.toBe(first.id);
    const details = await request(app).get(`/api/v1/conversations/${second.body.data.id}`).set(headers(buyerAuth));
    expect(details.body.data).toMatchObject({ productId: created.body.data.id, productTitle: 'Mel caseiro' });
    const firstDetails = await request(app).get(`/api/v1/conversations/${first.id}`).set(headers(buyerAuth));
    expect(firstDetails.body.data.productId).toBe(productId);
  });
  it.each(['sold', 'deleted'])('mantém contexto, lista e mensagens com produto %s', async status => {
    const id = (await open()).body.data.id;
    await Product.updateOne({ _id: productId }, { status });
    const detail = await request(app).get(`/api/v1/conversations/${id}`).set(headers(buyerAuth));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ productId, productTitle: 'Tomates' });
    expect((await send(id, buyerAuth, 'Ainda podemos falar?')).status).toBe(200);
    const messages = await request(app).get(`/api/v1/conversations/${id}/messages`).set(headers(sellerAuth));
    expect(messages.body.data.items[0].text).toBe('Ainda podemos falar?');
    const conversations = await request(app).get('/api/v1/conversations').set(headers(sellerAuth));
    expect(conversations.body.data.items[0].productId).toBe(productId);
    const product = await request(app).get(`/api/v1/products/${productId}`);
    expect(product.status).toBe(status === 'deleted' ? 404 : 200);
  });
  it('reutiliza a conversa, envia nos dois sentidos e mantém contadores separados', async () => {
    const openings = await Promise.all([open(), open()]);
    const id = openings[0].body.data.id;
    expect(openings[1].body.data.id).toBe(id);
    expect((await open()).body.data.id).toBe(id);
    const first = await send(id, buyerAuth, 'Bom dia!');
    expect(first.status).toBe(200);
    expect(first.body.data.senderId).toBe(buyerAuth.user.id);
    const second = await send(id, sellerAuth, 'Olá, tenho disponível.');
    expect(second.status).toBe(200);
    const sellerList = (await request(app).get('/api/v1/conversations').set(headers(sellerAuth))).body.data;
    expect(sellerList.unreadTotal).toBe(1);
    expect(sellerList.items[0]).toMatchObject({ unreadCount: 1, lastMessage: 'Olá, tenho disponível.', participant: { id: buyerAuth.user.id } });
    const read = await request(app).patch(`/api/v1/conversations/${id}/read`).set(headers(sellerAuth)).send({ messageIds: [first.body.data.id] });
    expect(read.status).toBe(200);
    expect((await request(app).get('/api/v1/conversations').set(headers(sellerAuth))).body.data.unreadTotal).toBe(0);
    expect((await request(app).get('/api/v1/conversations').set(headers(buyerAuth))).body.data.unreadTotal).toBe(1);
    const history = await request(app).get(`/api/v1/conversations/${id}/messages`).set(headers(buyerAuth));
    expect(history.body.data.items.map((item) => item.text)).toEqual(['Bom dia!', 'Olá, tenho disponível.']);
  });
  it('não duplica envios repetidos e não marca chegadas posteriores como lidas', async () => {
    const id = (await open()).body.data.id;
    const first = (await send(id, buyerAuth, 'Primeira')).body.data;
    const retries = await Promise.all([send(id, buyerAuth, 'Primeira'), send(id, buyerAuth, 'Primeira')]);
    expect(retries.map((reply) => reply.body.data.id)).toEqual([first.id, first.id]);
    expect((await send(id, buyerAuth, 'Texto diferente')).status).toBe(409);
    await send(id, buyerAuth, 'Segunda', 'message-test-002');
    await request(app).patch(`/api/v1/conversations/${id}/read`).set(headers(sellerAuth)).send({ messageIds: [first.id] });
    expect((await request(app).get('/api/v1/conversations').set(headers(sellerAuth))).body.data.unreadTotal).toBe(1);
    expect((await request(app).get(`/api/v1/conversations/${id}/messages`).set(headers(sellerAuth))).body.data.items).toHaveLength(2);
  });
  it('bloqueia terceiros, conversas consigo próprio e pedidos inválidos', async () => {
    const id = (await open()).body.data.id;
    expect((await request(app).get('/api/v1/conversations')).status).toBe(401);
    expect((await request(app).get('/api/v1/conversations').set(headers(outsiderAuth))).body.data.items).toEqual([]);
    expect((await request(app).get(`/api/v1/conversations/${id}/messages`).set(headers(outsiderAuth))).status).toBe(404);
    expect((await send(id, outsiderAuth, 'Intruso')).status).toBe(404);
    const sent = (await send(id, buyerAuth, 'Olá')).body.data;
    expect((await request(app).patch(`/api/v1/conversations/${id}/read`).set(headers(outsiderAuth)).send({ messageIds: [sent.id] })).status).toBe(404);
    expect((await request(app).post('/api/v1/conversations').set(headers(sellerAuth)).send({ productId })).status).toBe(422);
    expect((await send(id, buyerAuth, '   ')).status).toBe(422);
    expect((await send(id, buyerAuth, 'a'.repeat(2001))).status).toBe(422);
    expect((await request(app).get('/api/v1/conversations/invalid/messages').set(headers(buyerAuth))).status).toBe(422);
  });
  it('pagina o histórico sem repetir mensagens e mantém a ordem', async () => {
    const id = (await open()).body.data.id;
    for (let index = 0; index < 5; index++) await send(id, buyerAuth, `Mensagem ${index}`, `pagination-${index}`);
    const page1 = (await request(app).get(`/api/v1/conversations/${id}/messages?limit=2`).set(headers(sellerAuth))).body.data;
    expect(page1.items.map((item) => item.text)).toEqual(['Mensagem 3', 'Mensagem 4']);
    const page2 = (await request(app).get(`/api/v1/conversations/${id}/messages?limit=2&before=${page1.nextCursor}`).set(headers(sellerAuth))).body.data;
    expect(page2.items.map((item) => item.text)).toEqual(['Mensagem 1', 'Mensagem 2']);
    const page3 = (await request(app).get(`/api/v1/conversations/${id}/messages?limit=2&before=${page2.nextCursor}`).set(headers(sellerAuth))).body.data;
    expect(page3.items.map((item) => item.text)).toEqual(['Mensagem 0']);
    expect(page3.nextCursor).toBeNull();
  });
});


describe('compatibilidade com contas e índices existentes', () => {
  it('migra o índice sem perder dados e permite repetir a migration', async () => {
    const db = mongoose.connection.getClient().db('optional-phone-migration-test');
    try {
      const users = db.collection('users');
      await users.createIndex({ phone: 1 }, { unique: true, name: 'phone_1' });
      await users.insertOne({ email: 'antigo@email.pt', phone: '+351912345678' });
      await migrateOptionalPhone(db);
      await migrateOptionalPhone(db);
      await users.insertMany([{ email: 'novo1@email.pt' }, { email: 'novo2@email.pt' }]);
      expect(await users.countDocuments()).toBe(3);
      expect((await users.findOne({ email: 'antigo@email.pt' })).phone).toBe('+351912345678');
      await expect(users.insertOne({ phone: '+351912345678' })).rejects.toMatchObject({ code: 11000 });
      expect((await users.indexes()).map(index => index.name)).not.toContain('phone_1');
    } finally { await db.dropDatabase(); }
  });
  it('mantém login, localização e roles de uma conta antiga', async () => {
    await register();
    await User.updateOne({}, { emailVerified: true, roles: ['buyer'] });
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ roles: ['buyer'], phone: '+351912345678',
      location: { city: 'Mirandela', postalCode: '5370-000' } });
  });
});

describe('edição da localização do perfil', () => {
  const edit = async location => {
    await register(); await verifyUserInDatabase();
    const auth = (await login()).body.data;
    return request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${auth.accessToken}`).send({ location });
  };
  it('resolve códigos em nomes e coordenadas e preserva os restantes dados', async () => {
    const response = await edit({ municipalityCode: '0407', parishCode: '040701' });
    expect(response.status).toBe(200);
    expect(response.body.data.location).toMatchObject({ municipalityCode: '0407', parishCode: '040701', municipality: 'Mirandela', parish: 'Abambres', geo: { type: 'Point', coordinates: [-7.18, 41.48] } });
    expect(response.body.data.location.postalCode).toBeUndefined();
    expect((await User.findOne()).phone).toBe('+351912345678');
    const auth = (await login()).body.data;
    expect(auth.user.location.parishCode).toBe('040701');
  });
  it('rejeita freguesia de outro concelho sem alterar o perfil', async () => {
    expect((await edit({ municipalityCode: '0407', parishCode: '999901' })).status).toBe(422);
    expect((await User.findOne()).location.city).toBe('Mirandela');
  });
  it('rejeita localização incompleta', async () => {
    expect((await edit({ municipalityCode: '0407' })).status).toBe(422);
  });
  it('mantém compatibilidade com pedidos antigos', async () => {
    const response = await edit({ city: 'Chaves', postalCode: '5400-629' });
    expect(response.status).toBe(200);
    expect(response.body.data.location.city).toBe('Chaves');
  });
});
