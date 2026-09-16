import { productImages, coverFields, MAX_PRODUCT_IMAGES } from '../utils/productImages.js';
import mongoose from 'mongoose';

const productImageSchema = new mongoose.Schema({
  filename: { type: String }, url: { type: String }
}, { _id: false });
const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  price: { type: Number, required: true, min: 0.01 },
  unit: { type: String, required: true, enum: ['€/kg', '€/unidade', '€/dúzia', '€/frasco', '€/caixa'] },
  category: { type: String, required: true, enum: ['Frutas', 'Legumes', 'Ovos', 'Mel', 'Laticínios', 'Padaria', 'Bebidas', 'Conservas', 'Outros'], index: true },
  self_harvest: { type: Boolean, default: false },
  seasonality: { type: String, enum: ['all_year', 'spring', 'summer', 'autumn', 'winter'], default: 'all_year' },
  location: { type: String, required: true, trim: true, maxlength: 500 },
  address: { municipalityCode: String, parishCode: String, locality: String, municipality: String, parish: String, version: String },
  geo: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number], default: undefined } },
  // Historical products retain their original source; new locations only use parish.
  locationSource: { type: String, enum: ['gps', 'manual', 'parish'] },
  image: { type: String, default: null },
  imageFilename: { type: String, default: null },
  images: { type: [productImageSchema], default: undefined, validate: { validator: images => images.length <= MAX_PRODUCT_IMAGES && images.every(image => Boolean(image.filename) !== Boolean(image.url)) && new Set(images.map(image => image.filename || image.url)).size === images.length, message: 'Indica até 6 fotografias distintas.' } },
  imagesRevision: { type: Number, default: 0, min: 0 },
  pendingImageFilenames: { type: [String], default: [], select: false },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['active', 'sold', 'deleted'], default: 'active', index: true },
  is_active: { type: Boolean, default: true, index: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

productSchema.pre('validate', function () {
  if (!Array.isArray(this.images)) this.images = productImages(this);
  Object.assign(this, coverFields(this.images));
  if (!['Frutas', 'Legumes'].includes(this.category)) this.self_harvest = false;
});

productSchema.index({ 'images.filename': 1 }, { sparse: true });
productSchema.index({ imageFilename: 1 }, { sparse: true });
productSchema.index({ geo: '2dsphere' });
productSchema.index({ title: 'text', description: 'text' });
productSchema.set('toJSON', { transform(doc, ret) {
  ret.images = productImages(ret); ret.imagesRevision ??= 0; Object.assign(ret, coverFields(ret.images));
  if (doc.$locals.sellerSummary && ret.seller) ret.seller = { ...ret.seller, ...doc.$locals.sellerSummary };
  ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.geo; delete ret.pendingImageFilenames;
  return ret;
} });

export const Product = mongoose.model('Product', productSchema);
