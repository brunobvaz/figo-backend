import { z } from 'zod';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { Transaction } from '../models/Transaction.js';
import { Session } from '../models/Session.js';
import { PushDevice } from '../models/PushDevice.js';
import { withAccountLocks } from './accountGuard.js';
import { AppError } from '../utils/AppError.js';

export const categories = Product.schema.path('category').enumValues;
export const units = Product.schema.path('unit').enumValues;
const dayMs = 86400000;
const completed = ['completed', 'reviewed'];
const userFields = 'name firstName lastName email phone status usageIntent location avatarFilename emailVerified createdAt lastLoginAt';
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isoDay = date => date.toISOString().slice(0, 10);
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDay(date) === value;
}, 'Data inválida.');

export function reportRange(query) {
  const dates = z.object({ from: dateField.optional(), to: dateField.optional() }).parse(query);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const end = dates.to ? new Date(`${dates.to}T00:00:00Z`) : today;
  const start = dates.from ? new Date(`${dates.from}T00:00:00Z`) : new Date(end.getTime() - 29 * dayMs);
  const days = Math.round((end - start) / dayMs) + 1;
  if (days < 1 || days > 366) throw new AppError(422, 'INVALID_DATE_RANGE', 'Seleciona um período entre 1 e 366 dias.');
  const until = new Date(end.getTime() + dayMs);
  return { start, end, until, days, previous: new Date(start.getTime() - days * dayMs), from: isoDay(start), to: isoDay(end) };
}

function listQuery(query) {
  return z.object({
    search: z.string().trim().max(120).default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(12),
    status: z.string().max(40).default(''),
    category: z.enum(categories).optional()
  }).parse(query);
}

async function paginate(model, filter, query, select, populate) {
  const { page, limit } = query;
  let cursor = model.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
  if (select) cursor = cursor.select(select);
  if (populate) cursor = cursor.populate(populate);
  const [items, total] = await Promise.all([cursor, model.countDocuments(filter)]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function daily(model, match, field = 'createdAt', revenue = false) {
  return model.aggregate([{ $match: match }, { $group: {
    _id: { $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone: 'UTC' } },
    count: { $sum: 1 }, ...(revenue ? { revenue: { $sum: '$totalPriceSnapshot' } } : {})
  } }]);
}

export const adminService = {
  async dashboard(query) {
    const range = reportRange(query);
    const window = { $gte: range.previous, $lt: range.until };
    const [products, users, transactions, activeProducts, registeredUsers, categoryCounts, recentProducts, recentUsers] = await Promise.all([
      daily(Product, { createdAt: window }), daily(User, { createdAt: window }),
      daily(Transaction, { status: { $in: completed }, completedAt: window }, 'completedAt', true),
      Product.aggregate([{ $match: { status: 'active', is_active: { $ne: false } } },
        { $lookup: { from: 'users', localField: 'seller', foreignField: '_id', pipeline: [{ $match: { status: 'active' } }, { $project: { _id: 1 } }], as: 'owner' } },
        { $match: { 'owner.0': { $exists: true } } }, { $count: 'total' }]),
      User.countDocuments({ status: { $nin: ['deleted', 'deletion_pending'] } }),
      this.categories(), this.products({ limit: 5 }), this.users({ limit: 5 })
    ]);
    const maps = [products, users, transactions].map(items => new Map(items.map(item => [item._id, item])));
    const activity = Array.from({ length: range.days }, (_, index) => {
      const date = isoDay(new Date(range.start.getTime() + index * dayMs));
      return { date, products: maps[0].get(date)?.count || 0, users: maps[1].get(date)?.count || 0,
        transactions: maps[2].get(date)?.count || 0, revenue: maps[2].get(date)?.revenue || 0 };
    });
    const totals = (items, current, key = 'count') => items.filter(item => current ? item._id >= range.from : item._id < range.from).reduce((sum, item) => sum + (item[key] || 0), 0);
    const metric = (items, key) => ({ value: totals(items, true, key), previous: totals(items, false, key) });
    return { range: { from: range.from, to: range.to, days: range.days },
      stats: { activeProducts: activeProducts[0]?.total || 0, registeredUsers,
        newProducts: metric(products), newUsers: metric(users), transactions: metric(transactions), revenue: metric(transactions, 'revenue') },
      activity, categories: categoryCounts, recentProducts: recentProducts.items, recentUsers: recentUsers.items };
  },
  async categories() {
    const rows = await Product.aggregate([
      { $lookup: { from: 'users', localField: 'seller', foreignField: '_id', pipeline: [{ $match: { status: 'active' } }, { $project: { _id: 1 } }], as: 'owner' } },
      { $group: { _id: '$category', total: { $sum: 1 },
        active: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $ne: ['$is_active', false] }, { $gt: [{ $size: '$owner' }, 0] }] }, 1, 0] } } } }
    ]);
    return categories.map(name => ({ name, total: rows.find(row => row._id === name)?.total || 0, active: rows.find(row => row._id === name)?.active || 0 }));
  },
  products(input) {
    const query = listQuery(input);
    const filter = {};
    if (query.category) filter.category = query.category;
    if (query.search) filter.$or = ['title', 'description', 'location'].map(field => ({ [field]: new RegExp(escapeRegex(query.search), 'i') }));
    if (query.status) {
      z.enum(['active', 'inactive', 'sold', 'deleted']).parse(query.status);
      if (query.status === 'inactive') Object.assign(filter, { is_active: false, status: { $ne: 'deleted' } });
      else Object.assign(filter, { status: query.status }, query.status === 'active' ? { is_active: { $ne: false } } : {});
    }
    return paginate(Product, filter, query, null, { path: 'seller', select: 'name email status' });
  },
  users(input) {
    const query = listQuery(input);
    const filter = {};
    if (query.status) filter.status = z.enum(['active', 'suspended', 'deactivated', 'deletion_pending', 'deleted']).parse(query.status);
    if (query.search) filter.$or = ['name', 'email'].map(field => ({ [field]: new RegExp(escapeRegex(query.search), 'i') }));
    return paginate(User, filter, query, userFields);
  },
  transactions(input) {
    const query = listQuery(input);
    const filter = {};
    if (query.status) filter.status = z.enum(Transaction.schema.path('status').enumValues).parse(query.status);
    if (query.search) filter.productTitle = new RegExp(escapeRegex(query.search), 'i');
    if (input.from || input.to) { const range = reportRange(input); filter.createdAt = { $gte: range.start, $lt: range.until }; }
    return paginate(Transaction, filter, query,
      'productTitle quantity unit unitPriceSnapshot totalPriceSnapshot status buyer seller createdAt completedAt acceptedAt declinedAt',
      [{ path: 'buyer', select: 'name email' }, { path: 'seller', select: 'name email' }]);
  },
  async updateProduct(id, input) {
    const changes = z.object({ title: z.string().trim().min(2).max(120).optional(), description: z.string().trim().min(1).max(2000).optional(),
      category: z.enum(categories).optional(), price: z.number().min(0.01).max(1000000).optional(), unit: z.enum(units).optional(),
      is_active: z.boolean().optional(), featured: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0).parse(input);
    const initial = await Product.findById(id).select('seller');
    if (!initial) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Anúncio não encontrado.');
    return withAccountLocks([initial.seller], async () => {
      const product = await Product.findById(id);
      if (!product || product.status === 'deleted') throw new AppError(409, 'PRODUCT_DELETED', 'Não é possível alterar um anúncio removido.');
      if (changes.is_active === true && !await User.exists({ _id: product.seller, status: 'active' })) throw new AppError(409, 'OWNER_INACTIVE', 'O proprietário não tem uma conta ativa.');
      Object.assign(product, changes);
      await product.save();
      return product.populate('seller', 'name email status');
    });
  },
  async updateUserStatus(id, input) {
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).strict().parse(input);
    return withAccountLocks([id], async () => {
      const user = await User.findById(id).select(userFields);
      if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');
      if (!['active', 'suspended'].includes(user.status)) throw new AppError(409, 'USER_STATUS_LOCKED', 'Apenas contas ativas ou suspensas podem ser alteradas.');
      if (status === 'suspended') {
        // Revoke before changing status, while the same account lease used by
        // the mobile API prevents login/writes from racing this operation.
        await Session.deleteMany({ userId: id });
        await PushDevice.deleteMany({ user: id });
      }
      user.status = status;
      await user.save();
      return user;
    });
  }
};
