import { cleanProductImages } from './productImageCleanup.js';
import { guardAccountWrites } from './accountGuard.js';
import { productImages, productImageFilenames, coverFields } from '../utils/productImages.js';
import { prepareProductPhotos, removeProductPhoto } from './productPhotoService.js';
import mongoose from 'mongoose';
import { resolveLocation } from './locationService.js';
import { Product } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';
const sellerFields = 'name firstName lastName location avatarFilename createdAt status';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function findVisibleProduct(id, userId) {
  const product = await Product.findOne({ _id: id, status: { $ne: 'deleted' } }).populate('seller', sellerFields);
  if (!product || product.seller?.status !== 'active' || (product.is_active === false && String(product.seller?._id || product.seller) !== userId)) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  return product;
}

export const productService = {
  async list({ search, category, sellerId, page, limit, latitude, longitude, radiusKm, municipalityCode, parishCode, minPrice, maxPrice, sort, availableOnly, unit }, ownerId) {
    const filter = { status: availableOnly ? 'active' : { $ne: 'deleted' }, ...(ownerId && ownerId === sellerId ? {} : { is_active: { $ne: false } }) };
    if (unit) filter.unit = unit;
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
    // Filter owners before pagination and counts, including geospatial searches.
    const stages = latitude !== undefined && longitude !== undefined
      ? [{ $geoNear: { key: 'geo', near: { type: 'Point', coordinates: [longitude, latitude] }, distanceField: 'distanceMeters', ...(radiusKm !== undefined ? { maxDistance: radiusKm * 1000 } : {}), spherical: true, query: filter } }]
      : [{ $match: filter }];
    const [result] = await Product.aggregate([
      ...stages,
      { $lookup: { from: 'users', localField: 'seller', foreignField: '_id', pipeline: [{ $match: { status: 'active' } }, { $project: { _id: 1 } }], as: 'visibleOwner' } },
      { $match: { 'visibleOwner.0': { $exists: true } } },
      { $sort: latitude !== undefined && (!sort || sort === 'distance') ? { distanceMeters: 1, _id: 1 } : ordering },
      { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $set: { id: { $toString: '$_id' } } }, { $project: { geo: 0, __v: 0, visibleOwner: 0, pendingImageFilenames: 0 } }], count: [{ $count: 'total' }] } }
    ]);
    await Product.populate(result.items, { path: 'seller', select: sellerFields });
    const total = result.count[0]?.total || 0;
    return { items: result.items.map(item => ({ ...item, images: productImages(item), imagesRevision: item.imagesRevision || 0, ...coverFields(productImages(item)) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
  getById: findVisibleProduct,
  async create(userId, input, files) {
    input = await resolveLocation(input);
    const saved = [];
    let created;
    try {
      const { images } = await prepareProductPhotos(null, input, files, saved);
      const { imageOrder, imagesRevision, image, ...fields } = input;
      created = await Product.create({ ...fields, images, ...coverFields(images), seller: userId });
    } catch (error) {
      await Promise.allSettled(saved.map(photo => removeProductPhoto(photo.filename)));
      throw error;
    }
    return findVisibleProduct(created.id, userId);
  },
  async update(userId, id, changes, files) {
    const product = await Product.findOne({ _id: id, status: { $ne: 'deleted' } }).select('+pendingImageFilenames');
    if (!product || (product.is_active === false && String(product.seller?._id || product.seller) !== userId)) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    if (product.seller.toString() !== userId) throw new AppError(403, 'PRODUCT_FORBIDDEN', 'Só podes alterar os teus próprios produtos.');
    if ('locality' in changes && !('municipalityCode' in changes)) {
      if (!product.address?.parishCode) throw new AppError(422, 'INVALID_LOCATION', 'Seleciona o concelho e a freguesia.');
      const { locality, ...other } = changes;
      changes = { ...other, address: { ...product.address.toObject(), locality },
        location: `${locality}, ${product.address.parish}, ${product.address.municipality}` };
    } else changes = await resolveLocation(changes);
    const previousImages = productImageFilenames(product);
    const saved = [];
    try {
      const { images, changed } = await prepareProductPhotos(product, changes, files, saved);
      const { imageOrder, imagesRevision, image, ...fields } = changes;
      Object.assign(product, fields, { images, ...coverFields(images) });
      const retained = new Set(images.map(photo => photo.filename));
      product.pendingImageFilenames = [...new Set([...(product.pendingImageFilenames || []), ...previousImages.filter(filename => !retained.has(filename))])];
      if (changed) product.imagesRevision = (product.imagesRevision || 0) + 1;
      await product.save();
    } catch (error) {
      await Promise.allSettled(saved.map(photo => removeProductPhoto(photo.filename)));
      throw error;
    }
    await cleanProductImages(product.id).catch(() => {});
    return findVisibleProduct(product.id, userId);
  },
  async remove(userId, id) {
    const product = await Product.findOne({ _id: id, status: { $ne: 'deleted' } }).select('+pendingImageFilenames');
    if (!product || (product.is_active === false && String(product.seller?._id || product.seller) !== userId)) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    if (product.seller.toString() !== userId) throw new AppError(403, 'PRODUCT_FORBIDDEN', 'Só podes remover os teus próprios produtos.');
    product.pendingImageFilenames = [...new Set([...(product.pendingImageFilenames || []), ...productImageFilenames(product)])];
    product.status = 'deleted';
    product.deletedAt = new Date();
    await product.save();
    await cleanProductImages(product.id).catch(() => {});
  }
};

guardAccountWrites(productService, ['create', 'update', 'remove']);
