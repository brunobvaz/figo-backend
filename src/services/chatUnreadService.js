import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { Transaction } from '../models/Transaction.js';

export async function getUnreadChatCounts(userId) {
  const recipient = new mongoose.Types.ObjectId(userId);
  const [messages, purchases] = await Promise.all([
    Message.aggregate([
      { $match: { recipient, readAt: null } },
      { $group: { _id: '$conversation', count: { $sum: 1 } } }
    ]),
    Transaction.aggregate([
      { $match: { 'unreadEvents.recipient': recipient } },
      { $unwind: '$unreadEvents' },
      { $match: { 'unreadEvents.recipient': recipient } },
      { $group: { _id: '$conversation', count: { $sum: 1 } } }
    ])
  ]);
  const byConversation = new Map();
  for (const row of [...messages, ...purchases]) {
    const id = String(row._id);
    byConversation.set(id, (byConversation.get(id) || 0) + row.count);
  }
  return { total: [...byConversation.values()].reduce((sum, count) => sum + count, 0), byConversation };
}
