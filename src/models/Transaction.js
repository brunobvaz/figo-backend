import mongoose from 'mongoose';

export const activeTransactionStatuses = ['pending', 'accepted', 'buyer_confirmed', 'seller_confirmed', 'completed'];
// Reviews live with their transaction: publishing a review and advancing the
// transaction are one atomic write, including on standalone MongoDB servers.
// Explicit parties allow a future second direction without another review model.
const reviewSchema = new mongoose.Schema({
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientId: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  comment: { type: String, trim: true, maxlength: 2000, default: '' },
  createdAt: { type: Date, required: true }
});
const schema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, immutable: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  clientId: { type: String, required: true, immutable: true },
  productTitle: { type: String, required: true, immutable: true },
  unit: { type: String, required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, max: 9999, validate: Number.isInteger, immutable: true },
  unitPriceSnapshot: { type: Number, required: true, min: 0.01, immutable: true },
  totalPriceSnapshot: { type: Number, required: true, min: 0.01, immutable: true },
  status: { type: String, enum: [...activeTransactionStatuses, 'declined', 'reviewed', 'cancelled'], default: 'pending', required: true },
  revision: { type: Number, default: 0 },
  acceptedAt: Date,
  declinedAt: Date,
  buyerAgreementConfirmedAt: Date,
  sellerAgreementConfirmedAt: Date,
  // Kept for compatibility: this is the buyer's receipt/completion timestamp.
  buyerConfirmedAt: Date,
  completedAt: Date,
  reviewedAt: Date,
  reviews: { type: [reviewSchema], default: [] }
}, { timestamps: true });
schema.index({ conversation: 1, buyer: 1, clientId: 1 }, { unique: true });
// A new name adds the wider constraint without dropping the original index.
schema.index({ conversation: 1 }, { name: 'one_active_chat_purchase_v2', unique: true,
  partialFilterExpression: { status: { $in: activeTransactionStatuses } } });
schema.index({ conversation: 1, createdAt: 1 });
schema.index({ 'reviews.reviewedUser': 1, status: 1 });
schema.index({ buyer: 1, updatedAt: -1 });
schema.index({ seller: 1, status: 1, updatedAt: -1 });
export const Transaction = mongoose.model('Transaction', schema);
