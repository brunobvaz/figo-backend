import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productTitle: { type: String, required: true }
}, { timestamps: true });
schema.index({ product: 1, buyer: 1, seller: 1 }, { unique: true });
schema.index({ buyer: 1 });
schema.index({ seller: 1 });
export const Conversation = mongoose.model('Conversation', schema);
