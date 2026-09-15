import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  completedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lastError: { type: String, default: null },
  // Erase operational receipts after 30 days; the non-identifying user tombstone
  // continues to anchor the other participant's conversation history.
  cleanupAt: { type: Date, index: { expires: 0 } }
}, { timestamps: true });
export const AccountDeletion = mongoose.model('AccountDeletion', schema);
