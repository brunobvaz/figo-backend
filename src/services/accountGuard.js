import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const schema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  owner: String,
  expiresAt: { type: Date, index: { expires: 0 } }
});
const AccountLock = mongoose.model('AccountLock', schema);
const context = new AsyncLocalStorage();
const leaseMs = 60000;

// Database leases also serialize writers across API instances. Ordered locking
// avoids deadlocks when a conversation involves two accounts.
export async function withAccountLocks(userIds, work) {
  const held = context.getStore() || new Set();
  const ids = [...new Set(userIds.filter(Boolean).map(String))].filter(id => !held.has(id)).sort();
  const leases = [];
  try {
    for (const id of ids) {
      const owner = randomUUID();
      const deadline = Date.now() + 5000;
      for (;;) {
        try {
          await AccountLock.findOneAndUpdate({ _id: id, expiresAt: { $lte: new Date() } },
            { $set: { owner, expiresAt: new Date(Date.now() + leaseMs) } }, { upsert: true });
          break;
        } catch (error) {
          if (error.code !== 11000) throw error;
          if (Date.now() >= deadline) throw new AppError(409, 'ACCOUNT_BUSY', 'Existe um pedido em curso nesta conta. Tenta novamente dentro de instantes.');
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      }
      const timer = setInterval(() => AccountLock.updateOne({ _id: id, owner },
        { $set: { expiresAt: new Date(Date.now() + leaseMs) } }).catch(() => {}), leaseMs / 3);
      timer.unref();
      leases.push({ id, owner, timer });
    }
    return await context.run(new Set([...held, ...ids]), work);
  } finally {
    for (const { id, owner, timer } of leases.reverse()) {
      clearInterval(timer);
      await AccountLock.deleteOne({ _id: id, owner }).catch(() => {});
    }
  }
}

export function accountError(status) {
  if (status === 'deactivated') return new AppError(403, 'USER_DEACTIVATED', 'A tua conta está temporariamente desativada.');
  if (status === 'deletion_pending') return new AppError(403, 'USER_DELETION_PENDING', 'A eliminação da tua conta está em curso.');
  if (status === 'deleted') return new AppError(403, 'USER_DELETED', 'Esta conta foi eliminada.');
  if (status === 'suspended') return new AppError(403, 'USER_SUSPENDED', 'A conta encontra-se suspensa.');
  return new AppError(403, 'USER_INACTIVE', 'A conta não está ativa.');
}

export async function withActiveAccounts(userIds, work) {
  return withAccountLocks(userIds, async () => {
    for (const id of [...new Set(userIds.map(String))]) {
      const user = await User.findById(id).select('status');
      if (!user || user.status !== 'active') throw accountError(user?.status);
    }
    return work();
  });
}

export function guardAccountWrites(service, methods) {
  for (const method of methods) {
    const original = service[method];
    service[method] = (userId, ...args) => withActiveAccounts([userId], () => original.call(service, userId, ...args));
  }
  return service;
}
