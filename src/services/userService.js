import { guardAccountWrites } from './accountGuard.js';
import { warmImageVariants, removeImageVariants } from './imageService.js';
import { resolveUserLocation } from './locationService.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { avatarUploadDirectory } from '../config/uploads.js';
import { transactionService } from './transactionService.js';

export const userService = {
  async publicProfile(userId) {
    const user = await User.findOne({ _id: userId, status: 'active' }).select('name avatarFilename createdAt location.municipality location.parish location.city');
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Perfil indisponível.');
    const sellers = await transactionService.sellerSummaries([user.id]);
    return { id: user.id, name: user.name, avatarFilename: user.avatarFilename, createdAt: user.createdAt, location: user.location, ...sellers.get(user.id) };
  },
  async updateMe(userId, changes) {
    if (changes.firstName !== undefined && changes.lastName !== undefined) {
      changes = { ...changes, name: `${changes.firstName} ${changes.lastName}` };
    }
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
  }
};

guardAccountWrites(userService, ['updateMe', 'updateAvatar']);
