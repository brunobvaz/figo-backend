import { productImageFilenames } from '../utils/productImages.js';
import argon2 from 'argon2';
import { User } from '../models/User.js';
import { Product } from '../models/Product.js';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { Session } from '../models/Session.js';
import { OneTimeToken } from '../models/OneTimeToken.js';
import { EmailOtp } from '../models/EmailOtp.js';
import { PushDevice } from '../models/PushDevice.js';
import { PushDelivery } from '../models/PushDelivery.js';
import { AccountDeletion } from '../models/AccountDeletion.js';
import { withAccountLocks, accountError } from './accountGuard.js';
import { tokenService } from './tokenService.js';
import { authService } from './authService.js';
import { purgeImage } from './imageService.js';
import { avatarUploadDirectory, productUploadDirectory } from '../config/uploads.js';
import { normalizeEmail } from '../utils/normalizers.js';
import { AppError } from '../utils/AppError.js';

async function credentials(input, work) {
  const match = await User.findOne({ email: normalizeEmail(input.email) }).select('_id');
  if (!match) throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email ou palavra-passe inválidos.');
  return withAccountLocks([match.id], async () => {
    const user = await User.findById(match.id).select('+passwordHash');
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email ou palavra-passe inválidos.');
    }
    return work(user);
  });
}

async function revokeAccess(userId) {
  const devices = await PushDevice.find({ user: userId }).select('_id');
  const messages = await Message.find({ $or: [{ sender: userId }, { recipient: userId }] }).select('_id');
  await PushDelivery.deleteMany({ $or: [{ device: { $in: devices.map(d => d._id) } }, { message: { $in: messages.map(m => m._id) } }] });
  await Message.updateMany({ $or: [{ sender: userId }, { recipient: userId }] }, { $set: { pushState: 'queued' } });
  await Promise.all([
    Session.deleteMany({ userId }), PushDevice.deleteMany({ user: userId }),
    OneTimeToken.deleteMany({ userId }), EmailOtp.deleteMany({ userId })
  ]);
}

// Every step is repeatable. Keep filenames until their originals and variants
// have been removed, so interrupted filesystem cleanup can be retried.
export async function completeAccountDeletion(userId) {
  return withAccountLocks([userId], async () => {
    const user = await User.findById(userId);
    if (!user || !['deletion_pending', 'deleted'].includes(user.status)) return;
    if (user.status === 'deletion_pending') {
      await revokeAccess(userId);
      await Message.updateMany({ sender: userId }, { $set: { text: 'Mensagem removida', removedAt: user.deletionRequestedAt || new Date(), pushState: 'queued' } });
      await Conversation.updateMany({ seller: userId }, { $set: { productTitle: 'Anúncio indisponível' } });
      const products = await Product.find({ seller: userId }).select('imageFilename images +pendingImageFilenames');
      for (const product of products) {
        for (const filename of [...new Set([...productImageFilenames(product), ...(product.pendingImageFilenames || [])])]) await purgeImage(productUploadDirectory, filename);
      }
      await purgeImage(avatarUploadDirectory, user.avatarFilename);
      await Product.deleteMany({ seller: userId });
      // Replace the document, including any legacy fields. Only a generic
      // identity remains to anchor messages written by the other participant.
      await User.collection.replaceOne({ _id: user._id }, {
        _id: user._id, name: 'Conta eliminada', email: `deleted-${user.id}@account.invalid`,
        status: 'deleted', deletedAt: new Date()
      });
    }
    await AccountDeletion.updateOne({ user: userId }, { $set: { completedAt: new Date(), lastError: null, cleanupAt: new Date(Date.now() + 30 * 86400000) } }, { upsert: true });
  });
}

async function attemptDeletion(userId) {
  try { await completeAccountDeletion(userId); }
  catch (error) {
    await AccountDeletion.updateOne({ user: userId }, { $set: { lastError: 'CLEANUP_RETRY', nextAttemptAt: new Date(Date.now() + 30000) }, $inc: { attempts: 1 } });
    // No paths, credentials or personal data in retry logs.
    console.warn('Account deletion: cleanup will be retried.');
  }
}

export const accountService = {
  prepareDeletion(input) {
    return credentials(input, user => ({ userId: user.id, receipt: tokenService.accountReceipt(user.id) }));
  },
  deactivate(input) {
    return credentials(input, async user => {
      if (!['active', 'deactivated'].includes(user.status)) throw accountError(user.status);
      await User.updateOne({ _id: user.id }, { $set: { status: 'deactivated', deactivatedAt: user.deactivatedAt || new Date() } });
      await revokeAccess(user.id);
      return { status: 'deactivated', userId: user.id };
    });
  },
  reactivate(input, metadata) {
    return credentials(input, async user => {
      // A retry after a lost successful response must not hide ads again.
      if (user.status === 'active') return authService.login(input, metadata);
      if (user.status !== 'deactivated') throw accountError(user.status);
      await revokeAccess(user.id);
      // Availability must be reviewed after returning. Never restore a sold or
      // deleted listing, or reactivate one that the seller had hidden manually.
      await Product.updateMany({ seller: user.id, status: { $ne: 'deleted' } }, { $set: { is_active: false } });
      await User.updateOne({ _id: user.id }, { $set: { status: 'active', deactivatedAt: null } });
      return authService.login(input, metadata);
    });
  },
  remove(input) {
    return credentials(input, async user => {
      if (user.status === 'deleted') throw accountError(user.status);
      await User.updateOne({ _id: user.id }, { $set: { status: 'deletion_pending', deletionRequestedAt: user.deletionRequestedAt || new Date() } });
      await AccountDeletion.updateOne({ user: user.id }, { $setOnInsert: { nextAttemptAt: new Date() } }, { upsert: true });
      await attemptDeletion(user.id);
      const current = await User.findById(user.id).select('status');
      return { status: current.status, userId: user.id, receipt: tokenService.accountReceipt(user.id) };
    });
  },
  async deletionStatus(receipt) {
    let payload;
    try { payload = tokenService.verifyAccountReceipt(receipt); }
    catch { throw new AppError(401, 'ACCOUNT_RECEIPT_EXPIRED', 'O comprovativo expirou ou é inválido.'); }
    const user = await User.findById(payload.sub).select('status');
    if (!user || !['deleted', 'deletion_pending'].includes(user.status)) throw new AppError(404, 'ACCOUNT_DELETION_NOT_FOUND', 'Pedido não encontrado.');
    return { status: user.status };
  }
};

export async function processAccountDeletions() {
  // Recover the narrow crash window between hiding the account and saving its job.
  const pending = await User.find({ status: 'deletion_pending' }).select('_id');
  for (const user of pending) await AccountDeletion.updateOne({ user: user.id }, { $setOnInsert: { nextAttemptAt: new Date() } }, { upsert: true });
  const jobs = await AccountDeletion.find({ completedAt: null, nextAttemptAt: { $lte: new Date() } }).limit(20);
  for (const job of jobs) await attemptDeletion(job.user);
}

export function startAccountDeletionWorker() {
  let running;
  const tick = () => {
    if (running) return;
    running = processAccountDeletions().catch(() => console.warn('Account deletion worker: retry scheduled.')).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 10000);
  timer.unref(); tick();
  return async () => { clearInterval(timer); await running; };
}
