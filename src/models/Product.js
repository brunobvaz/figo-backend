import mongoose from 'mongoose';

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
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['active', 'sold', 'deleted'], default: 'active', index: true },
  is_active: { type: Boolean, default: true, index: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

productSchema.pre('validate', function () {
  if (!['Frutas', 'Legumes'].includes(this.category)) this.self_harvest = false;
});

productSchema.index({ geo: '2dsphere' });
productSchema.index({ title: 'text', description: 'text' });
productSchema.set('toJSON', { transform(_doc, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.geo; return ret; } });

export const Product = mongoose.model('Product', productSchema);
