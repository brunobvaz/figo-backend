import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { avatarUploadDirectory } from '../config/uploads.js';
import { AppError } from '../utils/AppError.js';

fs.mkdirSync(avatarUploadDirectory, { recursive: true });
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: avatarUploadDirectory,
  filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${extensions[file.mimetype]}`)
});

export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!extensions[file.mimetype]) return callback(new AppError(422, 'INVALID_AVATAR_TYPE', 'A fotografia deve ser JPEG, PNG ou WebP.'));
    callback(null, true);
  }
}).single('avatar');
