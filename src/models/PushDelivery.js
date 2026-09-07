import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'PushDevice', required: true },
  binding: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sending', 'receipt', 'checking_receipt', 'done', 'failed'], default: 'pending' },
  ticket: String,
  attempts: { type: Number, default: 0 },
  nextAttempt: { type: Date, default: Date.now },
  lastError: String,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 3600000) },
  cleanupAt: { type: Date, default: () => new Date(Date.now() + 7 * 86400000), index: { expires: 0 } }
}, { timestamps: true });
schema.index({ message: 1, device: 1, binding: 1 }, { unique: true });
schema.index({ status: 1, nextAttempt: 1 });
export const PushDelivery = mongoose.model('PushDelivery', schema);
