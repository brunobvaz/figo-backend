import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { Message } from '../src/models/Message.js';
import { Transaction } from '../src/models/Transaction.js';
import { Conversation } from '../src/models/Conversation.js';
import { PushDevice } from '../src/models/PushDevice.js';
import { PushDelivery } from '../src/models/PushDelivery.js';
import { pushDeviceService } from '../src/services/pushDeviceService.js';
import { queuePushMessages, processPushDeliveries } from '../src/services/pushService.js';
import { tokenService } from '../src/services/tokenService.js';
import { authService } from '../src/services/authService.js';

let mongo, sender, recipient, session, message, token, access;
const reply = (data) => ({ ok: true, json: async () => ({ data }) });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([PushDevice.init(), PushDelivery.init(), Message.init(), Conversation.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  const makeUser = (email, phone) => User.create({ name: 'Teste Push', firstName: 'Teste', lastName: 'Push', email, phone, passwordHash: 'unused', emailVerified: true, status: 'active', location: { city: 'Lisboa', postalCode: '1000-001' }, termsAcceptedAt: new Date(), ageConfirmedAt: new Date() });
  sender = await makeUser('sender@push.test', '+351911111111');
  recipient = await makeUser('recipient@push.test', '+351922222222');
  session = await Session.create({ userId: recipient.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 86400000) });
  token = 'ExpoPushToken[test-device-1]';
  await pushDeviceService.register(recipient.id, session.id, { token, platform: 'ios' });
  const conversation = await Conversation.create({ product: new mongoose.Types.ObjectId(), buyer: sender.id, seller: recipient.id, productTitle: 'Produto' });
  message = await Message.create({ conversation: conversation.id, sender: sender.id, recipient: recipient.id, text: 'Texto privado', clientId: 'push-message-1' });
  access = tokenService.generateAccessToken(recipient, session.id);
});

describe('notificações push', () => {
  it('regista tokens autenticados e não permite remover os de outra sessão', async () => {
    expect((await request(app).put('/api/v1/push/device').send({ token, platform: 'ios' })).status).toBe(401);
    const registered = await request(app).put('/api/v1/push/device').set('Authorization', `Bearer ${access}`).send({ token, platform: 'ios' });
    expect(registered.status).toBe(200);
    expect(await PushDevice.countDocuments()).toBe(1);
    expect((await request(app).put('/api/v1/push/device').set('Authorization', `Bearer ${access}`).send({ token: 'invalid', platform: 'ios' })).status).toBe(422);
    await pushDeviceService.remove(sender.id, session.id, token);
    expect(await PushDevice.countDocuments()).toBe(1);
    expect((await request(app).delete('/api/v1/push/device').set('Authorization', `Bearer ${access}`).send({ token })).status).toBe(200);
    expect(await PushDevice.countDocuments()).toBe(0);
  });
  it('persiste uma entrega por dispositivo, sem texto privado nem duplicar ao repetir a fila', async () => {
    await queuePushMessages(); await queuePushMessages();
    expect(await PushDelivery.countDocuments()).toBe(1);
    const fetcher = vi.fn().mockResolvedValue(reply({ status: 'ok', id: 'receipt-1' }));
    await processPushDeliveries({ fetcher }); await processPushDeliveries({ fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.body).toBe('Nova mensagem de Teste Push');
    expect(JSON.stringify(payload)).not.toContain('Texto privado');
    expect(payload.data).toMatchObject({ recipientId: recipient.id, conversationId: String(message.conversation), messageId: message.id });
    expect(payload.badge).toBe(1);
    expect((await PushDelivery.findOne()).status).toBe('receipt');
  });
  it('não envia depois de logout nem após leitura', async () => {
    await queuePushMessages();
    await Session.updateOne({ _id: session.id }, { revokedAt: new Date() });
    const fetcher = vi.fn();
    await processPushDeliveries({ fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    await Session.updateOne({ _id: session.id }, { revokedAt: null });
    await Message.updateOne({ _id: message.id }, { readAt: new Date(), pushState: 'pending' });
    await PushDelivery.deleteMany({});
    await queuePushMessages();
    expect(await PushDelivery.countDocuments()).toBe(0);
  });
  it('inclui novidades de compras no badge enviado com uma notificação de mensagem', async () => {
    await Transaction.create({ conversation: message.conversation, product: new mongoose.Types.ObjectId(),
      buyer: sender.id, seller: recipient.id, clientId: 'push-purchase', productTitle: 'Produto', unit: '€/kg',
      quantity: 1, unitPriceSnapshot: 2, totalPriceSnapshot: 2,
      unreadEvents: [{ recipient: recipient.id }, { recipient: recipient.id }, { recipient: sender.id }] });
    await queuePushMessages();
    const fetcher = vi.fn().mockResolvedValue(reply({ status: 'ok', id: 'receipt-purchase' }));
    await processPushDeliveries({ fetcher });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).badge).toBe(3);
  });
  it('cancela entregas de uma conta anterior quando o dispositivo muda de conta', async () => {
    await queuePushMessages();
    await pushDeviceService.register(sender.id, session.id, { token, platform: 'ios' });
    const fetcher = vi.fn();
    await processPushDeliveries({ fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('remove tokens inválidos indicados nos recibos', async () => {
    const now = new Date();
    await queuePushMessages(now);
    await processPushDeliveries({ now, fetcher: vi.fn().mockResolvedValue(reply({ status: 'ok', id: 'receipt-1' })) });
    await processPushDeliveries({ now: new Date(+now + 16 * 60000), fetcher: vi.fn().mockResolvedValue(reply({ 'receipt-1': { status: 'error', details: { error: 'DeviceNotRegistered' } } })) });
    expect(await PushDevice.countDocuments()).toBe(0);
    expect((await PushDelivery.findOne()).status).toBe('failed');
  });
  it('repete falhas temporárias e conclui após recibo positivo', async () => {
    const now = new Date();
    await queuePushMessages(now);
    await processPushDeliveries({ now, fetcher: vi.fn().mockRejectedValue(new Error('network')) });
    const job = await PushDelivery.findOne();
    expect(job.status).toBe('pending');
    expect(job.nextAttempt > now).toBe(true);
    await processPushDeliveries({ now: job.nextAttempt, fetcher: vi.fn().mockResolvedValue(reply({ status: 'ok', id: 'receipt-ok' })) });
    const sent = await PushDelivery.findOne();
    await processPushDeliveries({ now: sent.nextAttempt, fetcher: vi.fn().mockResolvedValue(reply({ 'receipt-ok': { status: 'ok' } })) });
    expect((await PushDelivery.findOne()).status).toBe('done');
  });
  it('envia para dois dispositivos do destinatário e nunca para o autor', async () => {
    await pushDeviceService.register(recipient.id, session.id, { token: 'ExpoPushToken[device-2]', platform: 'android' });
    await pushDeviceService.register(sender.id, session.id, { token: 'ExpoPushToken[sender-device]', platform: 'ios' });
    await Message.updateOne({ _id: message.id }, { readAt: new Date() });
    await Message.create({ conversation: message.conversation, sender: sender.id, recipient: recipient.id, text: 'Outra mensagem', clientId: 'push-message-2' });
    await queuePushMessages();
    const fetcher = vi.fn().mockResolvedValue(reply({ status: 'ok', id: 'ticket' }));
    await processPushDeliveries({ fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const tokens = fetcher.mock.calls.map((call) => JSON.parse(call[1].body).to).sort();
    expect(tokens).toEqual(['ExpoPushToken[device-2]', token].sort());
  });
  it('dois workers não enviam a mesma entrega em simultâneo', async () => {
    await queuePushMessages();
    const fetcher = vi.fn().mockResolvedValue(reply({ status: 'ok', id: 'ticket' }));
    await Promise.all([processPushDeliveries({ fetcher }), processPushDeliveries({ fetcher })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('não repete erros HTTP permanentes de configuração', async () => {
    await queuePushMessages();
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await processPushDeliveries({ fetcher });
    expect((await PushDelivery.findOne()).status).toBe('failed');
    await processPushDeliveries({ now: new Date(Date.now() + 600000), fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('mantém o token associado à sessão nova durante refresh', async () => {
    // Use a real login/session pair so rotation verifies the stored refresh hash.
    const { hashToken } = await import('../src/utils/crypto.js');
    const refreshToken = tokenService.generateRefreshToken(recipient, session.id);
    await Session.updateOne({ _id: session.id }, { refreshTokenHash: hashToken(refreshToken) });
    const result = await authService.refresh(refreshToken, {});
    const newSessionId = tokenService.verifyAccessToken(result.accessToken).sid;
    expect(String((await PushDevice.findOne()).session)).toBe(newSessionId);
    expect((await Session.findById(session.id)).revokedAt).toBeTruthy();
  });
});
