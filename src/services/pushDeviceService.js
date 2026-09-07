import crypto from 'node:crypto';
import { PushDevice } from '../models/PushDevice.js';
export const pushDeviceService = {
  async register(user, session, { token, platform }) {
    // Re-registering the same session is idempotent; a new login invalidates old deliveries.
    const existing = await PushDevice.findOne({ token });
    const binding = existing && String(existing.user) === user && String(existing.session) === session ? existing.binding : crypto.randomUUID();
    await PushDevice.findOneAndUpdate({ token }, { $set: { user, session, binding, platform } }, { upsert: true, new: true });
    return { registered: true };
  },
  async remove(user, session, token) {
    await PushDevice.deleteOne({ user, session, token });
    return { registered: false };
  }
};
