import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true, collection: 'admins' });

export const Admin = mongoose.model('Admin', schema);
export const adminSummary = admin => ({ id: admin.id, name: admin.name, email: admin.email });
