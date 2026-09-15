import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 2000 },
  removedAt: { type: Date, default: null },
  clientId: { type: String, required: true },
  pushState: { type: String, enum: ['pending', 'queued'], default: 'pending', index: true },
  readAt: { type: Date, default: null }
}, { timestamps: true });
schema.index({ conversation: 1, _id: -1 });
schema.index({ conversation: 1, sender: 1, clientId: 1 }, { unique: true });
schema.index({ recipient: 1, readAt: 1, conversation: 1 });
export const Message = mongoose.model('Message', schema);
