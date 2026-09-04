import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  refreshTokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null, index: true },
  userAgent: { type: String, default: null },
  ip: { type: String, default: null }
}, { timestamps: true });

export const Session = mongoose.model('Session', sessionSchema);
