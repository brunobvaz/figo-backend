import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  binding: { type: String, required: true },
  platform: { type: String, enum: ['ios', 'android'], required: true }
}, { timestamps: true });
export const PushDevice = mongoose.model('PushDevice', schema);
