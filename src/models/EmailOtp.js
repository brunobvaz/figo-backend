import mongoose from 'mongoose';

const emailOtpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, required: true }
}, { timestamps: true });

export const EmailOtp = mongoose.model('EmailOtp', emailOtpSchema);
