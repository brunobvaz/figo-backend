import { User } from '../models/User.js';
import { withActiveAccounts } from './accountGuard.js';
import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Product } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';

const memberFilter = (userId) => ({ $or: [{ buyer: userId }, { seller: userId }] });
const messageJson = (message) => ({ id: String(message._id), senderId: String(message.sender), text: message.text, clientId: message.clientId, createdAt: message.createdAt, readAt: message.readAt, removedAt: message.removedAt });
async function requireMember(id, userId) {
  const conversation = await Conversation.findOne({ _id: id, ...memberFilter(userId) });
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
  return conversation;
}

const isRemoved = status => ['deleted', 'deletion_pending'].includes(status);
function availability(other) {
  const canSend = other?.status === 'active';
  return { canSend, participant: { id: other?.id || (other?._id && String(other._id)),
    status: other?.status || 'deleted',
    name: canSend ? other.name : isRemoved(other?.status) || !other ? 'Conta eliminada' : 'Utilizador indisponível',
    avatarFilename: canSend ? other.avatarFilename : null },
    unavailableReason: canSend ? null : isRemoved(other?.status) || !other ? 'Esta conta foi eliminada. Não podes enviar mensagens.' : 'Esta conta está indisponível. Não podes enviar mensagens.' };
}
function productTitle(conversation) {
  return conversation.seller?.status === 'active' ? conversation.productTitle : 'Anúncio indisponível';
}

export const chatService = {
  async detail(userId, id) {
    const conversation = await requireMember(id, userId);
    await conversation.populate({ path: 'buyer seller', select: 'name avatarFilename status' });
    const other = String(conversation.buyer?._id) === userId ? conversation.seller : conversation.buyer;
    return { id: conversation.id, productId: String(conversation.product), productTitle: productTitle(conversation), ...availability(other) };
  },
  async open(userId, productId) {
    const product = await Product.findOne({ _id: productId, is_active: { $ne: false }, status: { $ne: 'deleted' } });
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    if (String(product.seller) === userId) throw new AppError(422, 'SELF_CONVERSATION', 'Não podes iniciar uma conversa contigo próprio.');
    const key = { product: product.id, buyer: userId, seller: product.seller };
    let conversation;
    try {
      conversation = await Conversation.findOneAndUpdate(key, { $setOnInsert: { ...key, productTitle: product.title } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await Conversation.findOne(key);
    }
    return { id: String(conversation._id) };
  },
  async list(userId, page, limit) {
    // Summaries are derived from persisted messages, so retries cannot corrupt counters.
    const user = new mongoose.Types.ObjectId(userId);
    const [items, total, unreadTotal] = await Promise.all([
      Conversation.aggregate([
        { $match: { $or: [{ buyer: user }, { seller: user }] } },
        { $lookup: { from: 'messages', let: { conversationId: '$_id' }, pipeline: [
          { $match: { $expr: { $eq: ['$conversation', '$$conversationId'] } } },
          { $sort: { _id: -1 } }, { $limit: 1 }
        ], as: 'latest' } },
        { $set: { lastActivity: { $ifNull: [{ $arrayElemAt: ['$latest.createdAt', 0] }, '$createdAt'] } } },
        { $sort: { lastActivity: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }
      ]),
      Conversation.countDocuments(memberFilter(userId)),
      Message.countDocuments({ recipient: userId, readAt: null })
    ]);
    await Conversation.populate(items, { path: 'buyer seller', select: 'name avatarFilename status' });
    const summaries = await Promise.all(items.map(async (item) => {
      const other = String(item.buyer?._id) === userId ? item.seller : item.buyer;
      return {
        id: String(item._id), productId: String(item.product), productTitle: productTitle(item), ...availability(other),
        lastMessage: item.latest[0] && String(item.latest[0].sender) !== userId && (!other || isRemoved(other.status)) ? 'Mensagem removida' : item.latest[0]?.text || '', updatedAt: item.lastActivity,
        unreadCount: await Message.countDocuments({ conversation: item._id, recipient: userId, readAt: null })
      };
    }));
    return { items: summaries, unreadTotal, pagination: { page, limit, total } };
  },
  async messages(userId, id, { before, limit }) {
    const detail = await this.detail(userId, id);
    const rows = await Message.find({ conversation: id, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return { ...detail, items: page.reverse().map(row => messageJson(String(row.sender) !== userId && isRemoved(detail.participant.status) ? { ...row, text: 'Mensagem removida', removedAt: row.removedAt || new Date() } : row)), nextCursor: hasMore ? String(page[0]._id) : null };
  },
  async send(userId, id, { text, clientId }) {
    const conversation = await requireMember(id, userId);
    const key = { conversation: id, sender: userId, clientId };
    const recipient = String(conversation.buyer) === userId ? conversation.seller : conversation.buyer;
    let message;
    try {
      message = await Message.findOneAndUpdate(key, { $setOnInsert: { ...key, recipient, text } }, { upsert: true, new: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      message = await Message.findOne(key);
    }
    if (message.text !== text) throw new AppError(409, 'MESSAGE_ID_REUSED', 'Este identificador já foi utilizado noutra mensagem.');
    return messageJson(message);
  },
  async read(userId, id, messageIds) {
    await requireMember(id, userId);
    // Only acknowledge messages actually displayed; concurrent arrivals remain unread.
    await Message.updateMany({ _id: { $in: messageIds }, conversation: id, recipient: userId, readAt: null }, { $set: { readAt: new Date() } });
    return { success: true };
  }
};

// Both participants must still be active at the moment the write is committed.
const originalOpen = chatService.open;
chatService.open = async (userId, productId) => {
  const product = await Product.findById(productId).select('seller');
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  try { return await withActiveAccounts([userId, product.seller], () => originalOpen.call(chatService, userId, productId)); }
  catch (error) {
    if (error.code?.startsWith('USER_') && (await User.findById(userId).select('status'))?.status === 'active') throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    throw error;
  }
};
const originalSend = chatService.send;
chatService.send = async (userId, id, input) => {
  const conversation = await requireMember(id, userId);
  const otherId = String(conversation.buyer) === userId ? conversation.seller : conversation.buyer;
  try { return await withActiveAccounts([userId, otherId], () => originalSend.call(chatService, userId, id, input)); }
  catch (error) {
    if (error.code?.startsWith('USER_') && (await User.findById(userId).select('status'))?.status === 'active') {
      throw new AppError(409, 'CONVERSATION_UNAVAILABLE', 'Esta conta está indisponível. Não podes enviar mensagens.');
    }
    throw error;
  }
};
