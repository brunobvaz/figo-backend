import { Product } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productUploadDirectory } from '../config/uploads.js';

const sellerFields = 'name firstName lastName location avatarFilename createdAt';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
async function saveImage(file) {
  if (!file) return null;
  await fs.mkdir(productUploadDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}${extensions[file.mimetype]}`;
  await fs.writeFile(path.join(productUploadDirectory, filename), file.buffer);
  return filename;
}
async function removeImage(filename) {
  if (filename) await fs.unlink(path.join(productUploadDirectory, path.basename(filename))).catch(() => {});
}

async function findVisibleProduct(id) {
  const product = await Product.findOne({ _id: id, status: { $ne: 'deleted' } }).populate('seller', sellerFields);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  return product;
}

export const productService = {
  async list({ search, category, sellerId, page, limit }) {
    const filter = { status: { $ne: 'deleted' } };
    if (category && category !== 'Todos') filter.category = category;
    if (sellerId) filter.seller = sellerId;
    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ title: expression }, { description: expression }, { location: expression }];
    }
    const [items, total] = await Promise.all([
      Product.find(filter).populate('seller', sellerFields).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Product.countDocuments(filter)
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
  getById: findVisibleProduct,
  async create(userId, input, imageFile) {
    const imageFilename = await saveImage(imageFile);
    let created;
    try { created = await Product.create({ ...input, image: null, imageFilename, seller: userId }); }
    catch (error) { await removeImage(imageFilename); throw error; }
    return findVisibleProduct(created.id);
  },
  async update(userId, id, changes, imageFile) {
    const product = await Product.findOne({ _id: id, status: { $ne: 'deleted' } });
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    if (product.seller.toString() !== userId) throw new AppError(403, 'PRODUCT_FORBIDDEN', 'Só podes alterar os teus próprios produtos.');
    const previousImage = product.imageFilename;
    const imageFilename = await saveImage(imageFile);
    Object.assign(product, changes, imageFilename ? { imageFilename, image: null } : {});
    try { await product.save(); }
    catch (error) { await removeImage(imageFilename); throw error; }
    if (imageFilename) await removeImage(previousImage);
    return findVisibleProduct(product.id);
  },
  async remove(userId, id) {
    const product = await Product.findOne({ _id: id, status: { $ne: 'deleted' } });
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    if (product.seller.toString() !== userId) throw new AppError(403, 'PRODUCT_FORBIDDEN', 'Só podes remover os teus próprios produtos.');
    product.status = 'deleted';
    product.deletedAt = new Date();
    await product.save();
    await removeImage(product.imageFilename);
  }
};
