import { env } from '../config/env.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { PushDevice } from '../models/PushDevice.js';
import { PushDelivery } from '../models/PushDelivery.js';

const minute = 60000;
const setDelivery = (job, values) => PushDelivery.updateOne({ _id: job._id }, { $set: values });
async function expoRequest(path, body, fetcher) {
  const response = await fetcher(`https://exp.host/--/api/v2/push/${path}`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = new Error(`EXPO_HTTP_${response.status}`);
    error.permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    throw error;
  }
  const result = await response.json();
  if (!result.data) throw new Error('EXPO_INVALID_RESPONSE');
  return result.data;
}
async function failOrRetry(job, code, now, permanent = false) {
  const terminal = permanent || job.attempts >= 5 || job.expiresAt <= now;
  await setDelivery(job, { status: terminal ? 'failed' : 'pending', lastError: code, nextAttempt: new Date(+now + Math.min(60, 2 ** job.attempts) * minute) });
  if (terminal) console.warn('Push delivery failed', { deliveryId: String(job._id), code });
}
async function providerError(job, error, now) {
  const code = error?.details?.error || 'EXPO_TICKET_ERROR';
  if (code === 'DeviceNotRegistered') await PushDevice.deleteOne({ _id: job.device, binding: job.binding });
  await failOrRetry(job, code, now, code !== 'MessageRateExceeded');
}

export async function queuePushMessages(now = new Date()) {
  // Pending is saved atomically with the message. Legacy messages have no pushState.
  const messages = await Message.find({ pushState: 'pending' }).sort({ _id: 1 }).limit(50);
  for (const message of messages) {
    if (!message.readAt && +now - +message.createdAt < 86400000) {
      const devices = await PushDevice.find({ user: message.recipient, createdAt: { $lte: message.createdAt } });
      for (const device of devices) {
        const key = { message: message._id, device: device._id, binding: device.binding };
        try { await PushDelivery.updateOne(key, { $setOnInsert: { ...key, nextAttempt: now } }, { upsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; }
      }
    }
    await Message.updateOne({ _id: message._id }, { $set: { pushState: 'queued' } });
  }
}

export async function processPushDeliveries({ now = new Date(), fetcher = fetch } = {}) {
  // A lease prevents simultaneous workers sending the same job. A crashed send can
  // be retried, but Expo/APNs/FCM cannot guarantee exactly-once delivery.
  await PushDelivery.updateMany({ status: 'checking_receipt', nextAttempt: { $lte: now } }, { $set: { status: 'receipt' } });
  await PushDelivery.updateMany({ status: 'sending', nextAttempt: { $lte: now } }, { $set: { status: 'pending' } });
  await PushDelivery.updateMany({ status: { $in: ['pending', 'receipt'] }, expiresAt: { $lte: now } }, { $set: { status: 'failed', lastError: 'DELIVERY_EXPIRED' } });
  for (let index = 0; index < 25; index++) {
    const job = await PushDelivery.findOneAndUpdate({ status: 'pending', nextAttempt: { $lte: now }, expiresAt: { $gt: now } }, { $set: { status: 'sending', nextAttempt: new Date(Math.max(+now, Date.now()) + 2 * minute) }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttempt: 1 } });
    if (!job) break;
    try {
      const [message, device] = await Promise.all([Message.findById(job.message), PushDevice.findOne({ _id: job.device, binding: job.binding })]);
      if (!message || message.readAt || !device || String(device.user) !== String(message.recipient)) {
        await setDelivery(job, { status: 'done', lastError: 'NO_LONGER_RELEVANT' }); continue;
      }
      const [session, recipient, sender] = await Promise.all([
        Session.exists({ _id: device.session, userId: device.user, revokedAt: null, expiresAt: { $gt: now } }),
        User.exists({ _id: device.user, status: 'active' }), User.findById(message.sender).select('name')
      ]);
      if (!session || !recipient) { await setDelivery(job, { status: 'done', lastError: 'SESSION_INACTIVE' }); continue; }
      const unread = await Message.countDocuments({ recipient: device.user, readAt: null });
      const ticket = await expoRequest('send', {
        to: device.token, title: 'Figo', body: `Nova mensagem de ${(sender?.name || 'um utilizador').slice(0, 80)}`,
        sound: 'default', channelId: 'messages', badge: unread, ttl: 3600,
        data: { type: 'chat.message', conversationId: String(message.conversation), messageId: String(message._id), recipientId: String(device.user) }
      }, fetcher);
      if (ticket.status === 'ok' && ticket.id) await setDelivery(job, { status: 'receipt', ticket: ticket.id, nextAttempt: new Date(+now + 15 * minute), lastError: null });
      else await providerError(job, ticket, now);
    } catch (error) { await failOrRetry(job, error.name === 'TimeoutError' ? 'EXPO_TIMEOUT' : (error.permanent ? error.message : 'EXPO_NETWORK_ERROR'), now, error.permanent); }
  }
  const receipts = [];
  for (let index = 0; index < 100; index++) {
    const job = await PushDelivery.findOneAndUpdate({ status: 'receipt', nextAttempt: { $lte: now }, expiresAt: { $gt: now } }, { $set: { status: 'checking_receipt', nextAttempt: new Date(Math.max(+now, Date.now()) + 2 * minute) } }, { new: true });
    if (!job) break;
    receipts.push(job);
  }
  if (!receipts.length) return;
  try {
    const result = await expoRequest('getReceipts', { ids: receipts.map((job) => job.ticket) }, fetcher);
    for (const job of receipts) {
      const receipt = result[job.ticket];
      if (!receipt) await setDelivery(job, { status: 'receipt', nextAttempt: new Date(+now + 15 * minute) });
      else if (receipt.status === 'ok') await setDelivery(job, { status: 'done' });
      else await providerError(job, receipt, now);
    }
  } catch (error) {
    for (const job of receipts) await PushDelivery.updateOne({ _id: job._id, status: 'checking_receipt' }, { $set: { status: 'receipt', nextAttempt: new Date(+now + 15 * minute), lastError: 'EXPO_RECEIPT_UNAVAILABLE' } });
  }
}

export function startPushWorker() {
  if (!env.PUSH_ENABLED) return async () => {};
  let running = null;
  const tick = () => {
    if (running) return;
    running = (async () => { await queuePushMessages(); await processPushDeliveries(); })()
      .catch(() => console.warn('Push worker: falha temporária; será repetido.'))
      .finally(() => { running = null; });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => { clearInterval(timer); if (running) await running; };
}
