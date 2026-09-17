import mongoose from 'mongoose';
import { z } from 'zod';
import { Transaction, activeTransactionStatuses } from '../models/Transaction.js';
import { Conversation } from '../models/Conversation.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { withActiveAccounts } from './accountGuard.js';
import { AppError } from '../utils/AppError.js';

const clientId = z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const proposalInput = z.object({ quantity: z.number().int().min(1).max(9999), clientId,
  expectedUnitPrice: z.number().positive().finite() }).strict();
export const reviewInput = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).default(''), clientId }).strict();
const forbidden = () => new AppError(403, 'TRANSACTION_FORBIDDEN', 'Não podes executar esta ação nesta compra.');
const conflict = () => new AppError(409, 'INVALID_TRANSACTION_STATE', 'O estado desta compra mudou. Atualiza a conversa.');
const json = (row, userId) => ({
  id: String(row._id), conversationId: String(row.conversation), productId: String(row.product),
  buyerId: String(row.buyer), sellerId: String(row.seller), clientId: row.clientId,
  productTitle: row.productTitle, unit: row.unit, quantity: row.quantity,
  unitPriceSnapshot: row.unitPriceSnapshot, totalPriceSnapshot: row.totalPriceSnapshot,
  status: row.status, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
  acceptedAt: row.acceptedAt, declinedAt: row.declinedAt, buyerConfirmedAt: row.buyerConfirmedAt,
  buyerAgreementConfirmedAt: row.buyerAgreementConfirmedAt, sellerAgreementConfirmedAt: row.sellerAgreementConfirmedAt,
  completedAt: row.completedAt, reviewedAt: row.reviewedAt,
  unreadEventIds: (row.unreadEvents || []).filter(event => String(event.recipient) === userId).map(event => String(event._id)),
  reviews: row.reviews.map(review => ({ id: String(review._id), transactionId: String(row._id),
    reviewerId: String(review.reviewer), reviewedUserId: String(review.reviewedUser),
    rating: review.rating, comment: review.comment, createdAt: review.createdAt }))
});
const finalized = { status: 'reviewed', completedAt: { $type: 'date' }, reviewedAt: { $type: 'date' }, $expr: { $ne: ['$buyer', '$seller'] } };
// Public comments and reputation must include exactly the same buyer → seller reviews.
const sellerReviews = { $filter: { input: '$reviews', as: 'review', cond: { $and: [
  { $eq: ['$$review.reviewer', '$buyer'] }, { $eq: ['$$review.reviewedUser', '$seller'] },
  { $gte: ['$$review.rating', 1] }, { $lte: ['$$review.rating', 5] }, { $eq: ['$$review.rating', { $floor: '$$review.rating' }] }
] } } };
function visibleJson(row, removed, userId) {
  const result = json(row, userId);
  if (removed.includes(result.sellerId)) result.productTitle = 'Anúncio indisponível';
  for (const review of result.reviews) if (removed.includes(review.reviewerId) || removed.includes(review.reviewedUserId)) review.comment = '';
  return result;
}
async function member(userId, conversationId) {
  const row = await Conversation.findOne({ _id: conversationId, $or: [{ buyer: userId }, { seller: userId }] });
  if (!row) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
  return row;
}
async function owned(userId, conversationId, transactionId, role) {
  await member(userId, conversationId);
  const row = await Transaction.findOne({ _id: transactionId, conversation: conversationId });
  if (!row) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Compra não encontrada.');
  if (String(row[role]) !== userId || String(row.buyer) === String(row.seller)) throw forbidden();
  return row;
}
async function withPurchaseAccounts(conversation, userId, work) {
  try { return await withActiveAccounts([conversation.buyer, conversation.seller], work); }
  catch (error) {
    // Match chat semantics: another participant's deactivation must never log
    // the still-active caller out through the client's USER_* error handler.
    if (error.code?.startsWith('USER_') && (await User.findById(userId).select('status'))?.status === 'active') {
      throw new AppError(409, 'CONVERSATION_UNAVAILABLE', 'Esta conta está indisponível. Não podes alterar esta compra.');
    }
    throw error;
  }
}
async function transition(userId, conversationId, transactionId, action) {
  const rules = {
    accept: ['seller', 'pending', 'accepted', 'acceptedAt'],
    decline: ['seller', 'pending', 'declined', 'declinedAt'],
    'confirm-buyer': ['buyer', 'accepted', 'buyer_confirmed', 'buyerAgreementConfirmedAt'],
    'confirm-seller': ['seller', 'buyer_confirmed', 'seller_confirmed', 'sellerAgreementConfirmedAt'],
    complete: ['buyer', 'seller_confirmed', 'completed', 'completedAt']
  };
  if (!rules[action]) throw conflict();
  const [role, from, to, timestamp] = rules[action];
  const conversation = await member(userId, conversationId);
  return withPurchaseAccounts(conversation, userId, async () => {
    const current = await owned(userId, conversationId, transactionId, role);
    // A replay never changes the original timestamp or regresses a later state.
    if (current[timestamp]) return json(current, userId);
    if (current.status !== from) throw conflict();
    const now = new Date();
    const dates = { [timestamp]: now, ...(action === 'complete' ? { buyerConfirmedAt: now } : {}) };
    const recipient = role === 'buyer' ? current.seller : current.buyer;
    const saved = await Transaction.findOneAndUpdate({ _id: current._id, [role]: userId, status: from },
      { $set: { status: to, ...dates }, $inc: { revision: 1 }, $push: { unreadEvents: { recipient } } }, { new: true, runValidators: true });
    if (!saved) throw conflict();
    return json(saved, userId);
  });
}

export const transactionService = {
  async context(userId, conversationId) {
    const conversation = await member(userId, conversationId);
    const [transactions, product, participants] = await Promise.all([
      Transaction.find({ conversation: conversationId }).sort({ createdAt: 1, _id: 1 }),
      Product.findById(conversation.product).select('title price unit status is_active'),
      User.find({ _id: { $in: [conversation.buyer, conversation.seller] } }).select('status')
    ]);
    const seller = participants.find(person => String(person._id) === String(conversation.seller));
    const removed = participants.filter(person => ['deleted', 'deletion_pending'].includes(person.status)).map(person => String(person._id));
    const history = transactions.map(row => visibleJson(row, removed, userId));
    const available = product?.status === 'active' && product.is_active !== false && seller?.status === 'active';
    return { buyerId: String(conversation.buyer), sellerId: String(conversation.seller), transactions: history,
      purchaseProduct: available ? { title: product.title, price: product.price, unit: product.unit } : null,
      canPropose: String(conversation.buyer) === userId && available && !transactions.some(row => activeTransactionStatuses.includes(row.status)) };
  },
  async propose(userId, conversationId, input) {
    const data = proposalInput.parse(input);
    const conversation = await member(userId, conversationId);
    if (String(conversation.buyer) !== userId || String(conversation.seller) === userId) throw forbidden();
    return withPurchaseAccounts(conversation, userId, async () => {
      const key = { conversation: conversationId, buyer: userId, clientId: data.clientId };
      const replay = await Transaction.findOne(key);
      if (replay) {
        if (replay.quantity !== data.quantity || replay.unitPriceSnapshot !== data.expectedUnitPrice) throw new AppError(409, 'PROPOSAL_ID_REUSED', 'Este identificador já foi utilizado noutra proposta.');
        return json(replay, userId);
      }
      const product = await Product.findOne({ _id: conversation.product, seller: conversation.seller, status: 'active', is_active: { $ne: false } });
      if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'O produto já não está disponível para novas propostas.');
      if (product.price !== data.expectedUnitPrice) throw new AppError(409, 'PRODUCT_PRICE_CHANGED', 'O preço mudou. Confirma o novo total antes de enviar.', { price: product.price, unit: product.unit, title: product.title });
      const totalCents = Math.round((product.price * data.quantity + Number.EPSILON) * 100);
      if (!Number.isSafeInteger(totalCents)) throw new AppError(422, 'INVALID_TOTAL', 'O total da proposta é demasiado elevado.');
      try {
        return json(await Transaction.create({ ...key, product: product._id, seller: conversation.seller,
          productTitle: product.title, unit: product.unit, quantity: data.quantity,
          unitPriceSnapshot: product.price, totalPriceSnapshot: totalCents / 100,
          unreadEvents: [{ recipient: conversation.seller }] }), userId);
      } catch (error) {
        if (error.code !== 11000) throw error;
        throw new AppError(409, 'ACTIVE_TRANSACTION_EXISTS', 'Já existe uma compra em curso nesta conversa.');
      }
    });
  },
  transition,
  async review(userId, conversationId, transactionId, input) {
    const data = reviewInput.parse(input);
    const conversation = await member(userId, conversationId);
    return withPurchaseAccounts(conversation, userId, async () => {
      const current = await owned(userId, conversationId, transactionId, 'buyer');
      const previous = current.reviews.find(review => String(review.reviewer) === userId);
      if (previous) {
        if (previous.clientId === data.clientId && previous.rating === data.rating && previous.comment === data.comment) return json(current, userId);
        throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'Já avaliaste este vendedor nesta compra.');
      }
      if (current.status !== 'completed') throw conflict();
      const now = new Date();
      const saved = await Transaction.findOneAndUpdate({ _id: current._id, buyer: userId, status: 'completed', 'reviews.reviewer': { $ne: userId } },
        { $set: { status: 'reviewed', reviewedAt: now }, $inc: { revision: 1 },
          $push: { reviews: { ...data, reviewer: userId, reviewedUser: current.seller, createdAt: now },
            unreadEvents: { recipient: current.seller } } }, { new: true, runValidators: true });
      if (!saved) throw conflict();
      return json(saved, userId);
    });
  },
  async reputation(userId) {
    return (await this.sellerSummaries([userId])).get(String(userId)).reputation;
  },
  async sellerSummaries(userIds) {
    const ids = [...new Set(userIds.map(String))];
    const summaries = new Map(ids.map(id => [id, { salesCount: 0, reputation: { average: null, count: 0 } }]));
    if (!ids.length) return summaries;
    const rows = await Transaction.aggregate([
      { $match: { ...finalized, seller: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } } },
      { $project: { seller: 1, ratings: { $map: { input: sellerReviews, as: 'review', in: '$$review.rating' } } } },
      { $group: { _id: '$seller', salesCount: { $sum: 1 }, ratingTotal: { $sum: { $sum: '$ratings' } }, count: { $sum: { $size: '$ratings' } } } }
    ]);
    for (const row of rows) summaries.set(String(row._id), { salesCount: row.salesCount,
      reputation: { average: row.count ? Math.round(row.ratingTotal / row.count * 10) / 10 : null, count: row.count } });
    return summaries;
  },
  async publicReviews(userId, { page, limit }) {
    if (!await User.exists({ _id: userId, status: 'active' })) throw new AppError(404, 'USER_NOT_FOUND', 'Perfil indisponível.');
    const [result] = await Transaction.aggregate([
      { $match: { ...finalized, seller: new mongoose.Types.ObjectId(userId) } },
      { $project: { reviews: sellerReviews } },
      { $unwind: '$reviews' },
      { $facet: {
        items: [{ $sort: { 'reviews.createdAt': -1, 'reviews._id': -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
        totals: [{ $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$reviews.rating' } } }]
      } }
    ]);
    const people = await User.find({ _id: { $in: result.items.map(row => row.reviews.reviewer) } }).select('name status avatarFilename').lean();
    const byId = new Map(people.map(person => [String(person._id), person]));
    const total = result.totals[0]?.count || 0;
    return {
      items: result.items.map(({ reviews: review }) => {
        const author = byId.get(String(review.reviewer));
        const removed = !author || ['deleted', 'deletion_pending'].includes(author.status);
        const publicAuthor = author?.status === 'active';
        return { id: String(review._id), rating: review.rating, createdAt: review.createdAt,
          authorName: publicAuthor ? author.name : 'Comprador indisponível',
          authorId: publicAuthor ? String(author._id) : null,
          authorAvatarFilename: publicAuthor ? author.avatarFilename || null : null,
          comment: removed ? '' : review.comment || '' };
      }),
      reputation: { average: total ? Math.round(result.totals[0].average * 10) / 10 : null, count: total },
      pagination: { page, limit, total }
    };
  },
  async summary(userId) {
    const [sellers, ordersCount] = await Promise.all([
      this.sellerSummaries([userId]), Transaction.countDocuments({ ...finalized, buyer: userId })
    ]);
    return { ...sellers.get(String(userId)), ordersCount };
  },
  async history(userId, { role, page, limit }) {
    if (!['buyer', 'seller'].includes(role)) throw forbidden();
    const filter = { [role]: userId };
    const [rows, total] = await Promise.all([
      Transaction.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Transaction.countDocuments(filter)
    ]);
    const people = await User.find({ _id: { $in: rows.flatMap(row => [row.buyer, row.seller]) } }).select('name status');
    const byId = new Map(people.map(person => [String(person._id), person]));
    const removed = people.filter(person => ['deleted', 'deletion_pending'].includes(person.status)).map(person => String(person._id));
    return { items: rows.map(row => {
      const other = byId.get(String(role === 'buyer' ? row.seller : row.buyer));
      return { ...visibleJson(row, removed, userId), participantName: other?.status === 'active' ? other.name : removed.includes(String(other?._id)) || !other ? 'Conta eliminada' : 'Utilizador indisponível' };
    }), pagination: { page, limit, total } };
  }
};
