import mongoose from 'mongoose';
import { resolveLocation } from './locationService.js';
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
  if (!file.buffer?.length) throw new AppError(422, 'EMPTY_PRODUCT_IMAGE', 'A imagem recebida está vazia. Seleciona-a novamente.');
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
  async list({ search, category, sellerId, page, limit, latitude, longitude, radiusKm = 25, municipalityCode, parishCode, minPrice, maxPrice, sort }) {
    const filter = { status: { $ne: 'deleted' } };
    if (minPrice !== undefined || maxPrice !== undefined) filter.price = { ...(minPrice !== undefined ? { $gte: minPrice } : {}), ...(maxPrice !== undefined ? { $lte: maxPrice } : {}) };
    const ordering = sort === 'price_asc' ? { price: 1, _id: 1 } : sort === 'price_desc' ? { price: -1, _id: 1 } : { createdAt: -1, _id: -1 };
    if (category && category !== 'Todos') filter.category = category;
    if (sellerId) filter.seller = new mongoose.Types.ObjectId(sellerId);
    if (municipalityCode) filter['address.municipalityCode'] = municipalityCode;
    if (parishCode) filter['address.parishCode'] = parishCode;
    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ title: expression }, { description: expression }, { location: expression }];
    }
    if (latitude !== undefined && longitude !== undefined) {
      filter.status = 'active';
      const [result] = await Product.aggregate([
        { $geoNear: { key: 'geo', near: { type: 'Point', coordinates: [longitude, latitude] }, distanceField: 'distanceMeters', maxDistance: radiusKm * 1000, spherical: true, query: filter } },
        { $sort: !sort || sort === 'distance' ? { distanceMeters: 1, _id: 1 } : ordering },
        { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $set: { id: { $toString: '$_id' } } }, { $project: { geo: 0, __v: 0 } }], count: [{ $count: 'total' }] } }
      ]);
      await Product.populate(result.items, { path: 'seller', select: sellerFields });
      const total = result.count[0]?.total || 0;
      return { items: result.items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    }
    const [items, total] = await Promise.all([
      Product.find(filter).populate('seller', sellerFields).sort(ordering).skip((page - 1) * limit).limit(limit),
      Product.countDocuments(filter)
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
  getById: findVisibleProduct,
  async create(userId, input, imageFile) {
    input = await resolveLocation(input);
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
    if ('locality' in changes && !('municipalityCode' in changes)) {
      if (!product.address?.parishCode) throw new AppError(422, 'INVALID_LOCATION', 'Seleciona o concelho e a freguesia.');
      const { locality, ...other } = changes;
      changes = { ...other, address: { ...product.address.toObject(), locality },
        location: `${locality}, ${product.address.parish}, ${product.address.municipality}` };
    } else changes = await resolveLocation(changes);
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
