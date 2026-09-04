import mongoose from 'mongoose';

const oneTimeTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  type: { type: String, enum: ['passwordReset', 'emailVerification'], required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null }
}, { timestamps: true });

export const OneTimeToken = mongoose.model('OneTimeToken', oneTimeTokenSchema);
