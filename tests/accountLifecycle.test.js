import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Message } from '../src/models/Message.js';
import { Session } from '../src/models/Session.js';
import { OneTimeToken } from '../src/models/OneTimeToken.js';
import { EmailOtp } from '../src/models/EmailOtp.js';
import { PushDevice } from '../src/models/PushDevice.js';
import { PushDelivery } from '../src/models/PushDelivery.js';
import { AccountDeletion } from '../src/models/AccountDeletion.js';
import { accountService, completeAccountDeletion, processAccountDeletions } from '../src/services/accountService.js';
import { authService } from '../src/services/authService.js';
import { chatService } from '../src/services/chatService.js';
import { productService } from '../src/services/productService.js';
import { userService } from '../src/services/userService.js';
import { withAccountLocks } from '../src/services/accountGuard.js';
import { hashToken } from '../src/utils/crypto.js';
import { avatarUploadDirectory, productUploadDirectory } from '../src/config/uploads.js';

let mongo, passwordHash, seller, buyer, product, conversation, auth;
const password = 'Password!123';
const files = new Set();
const input = () => ({ email: seller.email, password, confirm: true });
const productBase = { title: 'Tomates da horta', description: 'Tomates frescos locais.', price: 2, unit: '€/kg', category: 'Legumes', location: 'Chaves', geo: { type: 'Point', coordinates: [-8, 41] } };
async function fixtureFile(directory, contents = 'test bytes') {
  const filename = `lifecycle-test-${randomUUID()}.jpg`;
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  await fs.writeFile(target, contents); files.add(target);
  return filename;
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  passwordHash = await argon2.hash(password);
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})));
  [seller, buyer] = await User.create(['seller', 'buyer'].map(name => ({ name, firstName: name, lastName: 'Teste', email: `${name}@example.test`, passwordHash, emailVerified: true, termsAcceptedAt: new Date() })));
  product = await Product.create({ ...productBase, seller: seller.id });
  conversation = await chatService.open(buyer.id, product.id);
  await chatService.send(seller.id, conversation.id, { text: 'Texto privado do vendedor', clientId: 'seller-message' });
  await chatService.send(buyer.id, conversation.id, { text: 'Mensagem que o comprador escreveu', clientId: 'buyer-message' });
  auth = await authService.login(input(), {});
});
afterEach(async () => { vi.restoreAllMocks(); for (const file of files) await fs.rm(file, { force: true, recursive: true }); files.clear(); });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

it('exige confirmação e palavra-passe, sem aceitar IDs de outras contas', async () => {
  expect((await request(app).post('/api/v1/auth/account/delete').send({ email: seller.email, password })).status).toBe(422);
  expect((await request(app).post('/api/v1/auth/account/deactivate').send({ ...input(), userId: buyer.id })).status).toBe(422);
  expect((await request(app).post('/api/v1/auth/account/delete').send({ ...input(), password: 'errada' })).status).toBe(401);
  expect((await User.findById(seller.id)).status).toBe('active');
  expect(await Product.countDocuments()).toBe(1);
  expect((await Message.findOne({ sender: seller.id })).text).toBe('Texto privado do vendedor');
});

it('desativa em todos os dispositivos, oculta anúncios e bloqueia contactos sem apagar dados', async () => {
  const device = await PushDevice.create({ user: seller.id, session: '111111111111111111111111', token: 'ExpoPushToken[test]', binding: 'test', platform: 'ios' });
  await PushDelivery.create({ device: device.id, message: (await Message.findOne()).id, binding: 'test' });
  await authService.login(input(), {});
  const result = await request(app).post('/api/v1/auth/account/deactivate').send(input());
  expect(result.status).toBe(200);
  expect(await Session.countDocuments({ userId: seller.id })).toBe(0);
  expect(await PushDevice.countDocuments({ user: seller.id })).toBe(0);
  expect(await PushDelivery.countDocuments()).toBe(0);
  expect((await Product.findById(product.id)).is_active).toBe(true);
  for (const query of [{ page: 1, limit: 1 }, { page: 1, limit: 1, latitude: 41, longitude: -8 }]) {
    const list = await productService.list(query); expect(list.items).toEqual([]); expect(list.pagination.total).toBe(0);
  }
  expect((await request(app).get(`/api/v1/products/${product.id}`)).status).toBe(404);
  expect((await request(app).get('/api/v1/auth/me').auth(auth.accessToken, { type: 'bearer' })).body.error.code).toBe('USER_DEACTIVATED');
  await expect(authService.login(input(), {})).rejects.toMatchObject({ code: 'USER_DEACTIVATED' });
  await expect(authService.refresh(auth.refreshToken, {})).rejects.toMatchObject({ code: 'USER_DEACTIVATED' });
  await expect(chatService.send(buyer.id, conversation.id, { text: 'Novo', clientId: 'new' })).rejects.toMatchObject({ code: 'CONVERSATION_UNAVAILABLE' });
  await expect(chatService.open(buyer.id, product.id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(userService.updateMe(seller.id, { name: 'Alterado' })).rejects.toMatchObject({ code: 'USER_DEACTIVATED' });
  const page = await chatService.messages(buyer.id, conversation.id, { limit: 20 });
  expect(page.canSend).toBe(false); expect(page.participant.name).toBe('Utilizador indisponível');
  expect(page.items.map(m => m.text)).toContain('Texto privado do vendedor');
});

it('reativa explicitamente sem republicar anúncios nem recuperar sessões antigas', async () => {
  const sold = await Product.create({ ...productBase, seller: seller.id, status: 'sold' });
  const hidden = await Product.create({ ...productBase, seller: seller.id, is_active: false });
  const deleted = await Product.create({ ...productBase, seller: seller.id, status: 'deleted' });
  await accountService.deactivate(input());
  const response = await request(app).post('/api/v1/auth/account/reactivate').send(input());
  expect(response.status).toBe(200); expect(response.body.data.user.status).toBe('active');
  for (const id of [product.id, sold.id, hidden.id]) expect((await Product.findById(id)).is_active).toBe(false);
  expect((await Product.findById(sold.id)).status).toBe('sold');
  expect((await Product.findById(deleted.id)).status).toBe('deleted');
  expect((await request(app).get('/api/v1/auth/me').auth(auth.accessToken, { type: 'bearer' })).status).toBe(401);
  expect((await chatService.detail(buyer.id, conversation.id)).canSend).toBe(true);
  await productService.update(seller.id, product.id, { is_active: true });
  expect((await productService.list({ page: 1, limit: 20 })).items).toHaveLength(1);
  // A repeated confirmation after a lost response must not reset publication.
  expect((await accountService.reactivate(input(), {})).user.status).toBe('active');
  expect((await Product.findById(product.id)).is_active).toBe(true);
});

it('permite recuperar a palavra-passe sem reativar a conta e impede reativação de sanções', async () => {
  await accountService.deactivate(input());
  const token = 'reset-token-account-test-123456789012345678';
  await OneTimeToken.create({ userId: seller.id, type: 'passwordReset', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000) });
  await authService.resetPassword(token, 'OutraPassword!123');
  expect((await User.findById(seller.id)).status).toBe('deactivated');
  await expect(accountService.reactivate(input(), {})).rejects.toMatchObject({ statusCode: 401 });
  await User.updateOne({ _id: seller.id }, { $set: { status: 'suspended' } });
  await expect(accountService.reactivate({ ...input(), password: 'OutraPassword!123' }, {})).rejects.toMatchObject({ code: 'USER_SUSPENDED' });
});

it('elimina todos os anúncios, imagens, dados pessoais e só o conteúdo das mensagens do autor', async () => {
  const avatar = await fixtureFile(avatarUploadDirectory);
  const image = await fixtureFile(productUploadDirectory);
  const variants = path.join(productUploadDirectory, '.variants', 'v1');
  await fs.mkdir(variants, { recursive: true });
  const variant = path.join(variants, `${image}-160.webp`); await fs.writeFile(variant, 'variant'); files.add(variant);
  await User.updateOne({ _id: seller.id }, { $set: { avatarFilename: avatar, phone: '+351912345678', location: { city: 'Morada privada' } } });
  await User.collection.updateOne({ _id: seller._id }, { $set: { legacySecret: 'old private data' } });
  await Product.updateOne({ _id: product.id }, { $set: { imageFilename: image } });
  await Product.create(['sold', 'deleted'].map(status => ({ ...productBase, seller: seller.id, status })));
  await EmailOtp.create({ userId: seller.id, codeHash: 'hash', expiresAt: new Date(Date.now() + 60000), lastSentAt: new Date() });
  const receipt = await accountService.prepareDeletion(input());
  expect((await request(app).get('/api/v1/auth/me').auth(receipt.receipt, { type: 'bearer' })).status).toBe(401);
  const result = await accountService.remove(input()); expect(result.status).toBe('deleted');
  expect(await accountService.deletionStatus(receipt.receipt)).toEqual({ status: 'deleted' });
  expect(await Product.countDocuments({ seller: seller.id })).toBe(0);
  expect(await EmailOtp.countDocuments({ userId: seller.id })).toBe(0);
  expect(await Session.countDocuments({ userId: seller.id })).toBe(0);
  for (const target of [path.join(avatarUploadDirectory, avatar), path.join(productUploadDirectory, image), variant]) await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  const tombstone = await User.collection.findOne({ _id: seller._id });
  expect(Object.keys(tombstone).sort()).toEqual(['_id', 'deletedAt', 'email', 'name', 'status']);
  expect(tombstone.name).toBe('Conta eliminada'); expect(tombstone.email).not.toBe(seller.email);
  const page = await chatService.messages(buyer.id, conversation.id, { limit: 20 });
  expect(page.participant.name).toBe('Conta eliminada'); expect(page.canSend).toBe(false);
  expect(page.items.map(m => m.text)).toEqual(['Mensagem removida', 'Mensagem que o comprador escreveu']);
  expect((await Message.findOne({ sender: seller.id })).removedAt).toBeTruthy();
  const reused = await User.create({ name: 'Novo utilizador', email: seller.email, passwordHash, termsAcceptedAt: new Date() });
  expect(reused.id).not.toBe(seller.id); expect((await chatService.list(reused.id, 1, 20)).items).toEqual([]);
  await completeAccountDeletion(seller.id); expect(await AccountDeletion.countDocuments()).toBe(1);
});

it('mantém pedido durável e indisponibilidade se uma imagem falhar; repete a limpeza', async () => {
  const filename = `lifecycle-test-${randomUUID()}.jpg`;
  const target = path.join(avatarUploadDirectory, filename);
  await fs.mkdir(target, { recursive: true }); files.add(target);
  await User.updateOne({ _id: seller.id }, { $set: { avatarFilename: filename } });
  const response = await request(app).post('/api/v1/auth/account/delete').send(input());
  expect(response.status).toBe(202); expect(response.body.data.status).toBe('deletion_pending');
  expect((await AccountDeletion.findOne()).attempts).toBe(1);
  expect((await chatService.detail(buyer.id, conversation.id)).participant.name).toBe('Conta eliminada');
  expect((await request(app).get(`/uploads/avatars/${filename}`)).status).toBe(404);
  expect((await productService.list({ page: 1, limit: 20 })).items).toHaveLength(0);
  await fs.rmdir(target);
  await AccountDeletion.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  await processAccountDeletions();
  expect(await accountService.deletionStatus(response.body.data.receipt)).toEqual({ status: 'deleted' });
});

it('redige imediatamente mensagens e resumos enquanto a limpeza está pendente', async () => {
  await chatService.send(seller.id, conversation.id, { text: 'Última mensagem privada', clientId: 'last' });
  await User.updateOne({ _id: seller.id }, { $set: { status: 'deletion_pending' } });
  const list = await chatService.list(buyer.id, 1, 20);
  expect(list.items[0].lastMessage).toBe('Mensagem removida'); expect(list.items[0].productTitle).toBe('Anúncio indisponível');
  const page = await chatService.messages(buyer.id, conversation.id, { limit: 20 });
  expect(page.items.filter(m => m.senderId === seller.id).every(m => m.text === 'Mensagem removida')).toBe(true);
  await processAccountDeletions(); // Recovers even if no job was saved before the crash.
  expect((await User.findById(seller.id)).status).toBe('deleted');
});

it('permite eliminar diretamente uma conta desativada', async () => {
  await accountService.deactivate(input());
  expect((await accountService.remove(input())).status).toBe('deleted');
  await expect(accountService.reactivate(input(), {})).rejects.toMatchObject({ statusCode: 401 });
});

it('serializa envios concorrentes com eliminação, sem deixar texto enviado após a limpeza', async () => {
  let release; let acquired;
  const ready = new Promise(resolve => { acquired = resolve; });
  const hold = withAccountLocks([seller.id], async () => { acquired(); await new Promise(resolve => { release = resolve; }); });
  await ready;
  const deleting = accountService.remove(input());
  const sending = chatService.send(seller.id, conversation.id, { text: 'Mensagem concorrente', clientId: 'concurrent' });
  release(); await hold;
  const result = await Promise.allSettled([deleting, sending]);
  expect(result[0].status).toBe('fulfilled');
  expect(await Message.countDocuments({ sender: seller.id, text: { $ne: 'Mensagem removida' } })).toBe(0);
  await expect(chatService.send(buyer.id, conversation.id, { text: 'Depois', clientId: 'after' })).rejects.toMatchObject({ code: 'CONVERSATION_UNAVAILABLE' });
});
