import { warmImageVariants, removeImageVariants } from './imageService.js';
import { resolveUserLocation } from './locationService.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { avatarUploadDirectory } from '../config/uploads.js';

export const userService = {
  async updateMe(userId, changes) {
    if (changes.location) changes = { ...changes, location: await resolveUserLocation(changes.location) };
    const user = await User.findByIdAndUpdate(userId, { $set: changes }, { new: true, runValidators: true });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');
    return user.toJSON();
  },
  async updateAvatar(userId, filename) {
    const user = await User.findById(userId);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');
    const previousFilename = user.avatarFilename;
    user.avatarFilename = filename;
    await user.save();
    warmImageVariants(avatarUploadDirectory, filename, [160, 320]).catch(() => {});
    if (previousFilename && previousFilename !== filename) {
      await fs.unlink(path.join(avatarUploadDirectory, path.basename(previousFilename))).catch(() => {});
      await removeImageVariants(avatarUploadDirectory, path.basename(previousFilename));
    }
    return user.toJSON();
  },
  async enableSeller(userId) {
    const user = await User.findByIdAndUpdate(userId, { $addToSet: { roles: 'seller' } }, { new: true, runValidators: true });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Utilizador não encontrado.');
    return user.toJSON();
  }
};
