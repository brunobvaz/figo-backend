import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, collection: 'admin_sessions' });

export const AdminSession = mongoose.model('AdminSession', schema);
