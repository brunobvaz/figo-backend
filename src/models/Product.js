import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  price: { type: Number, required: true, min: 0.01 },
  unit: { type: String, required: true, enum: ['€/kg', '€/unidade', '€/dúzia', '€/frasco', '€/caixa'] },
  category: { type: String, required: true, enum: ['Frutas', 'Legumes', 'Ovos', 'Mel', 'Laticínios', 'Padaria', 'Bebidas', 'Conservas', 'Outros'], index: true },
  location: { type: String, required: true, trim: true, maxlength: 120 },
  image: { type: String, default: null },
  imageFilename: { type: String, default: null },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['active', 'sold', 'deleted'], default: 'active', index: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

productSchema.index({ title: 'text', description: 'text' });
productSchema.set('toJSON', { transform(_doc, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret; } });

export const Product = mongoose.model('Product', productSchema);
