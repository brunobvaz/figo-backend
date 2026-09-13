import { userService } from '../services/userService.js';
import fs from 'node:fs/promises';
import { AppError } from '../utils/AppError.js';

export const userController = {
  async updateMe(req, res) {
    res.json({ success: true, data: await userService.updateMe(req.user.id, req.body) });
  },
  async updateAvatar(req, res) {
    if (!req.file) return res.status(422).json({ success: false, error: { code: 'AVATAR_REQUIRED', message: 'Seleciona uma fotografia.' } });
    if (!req.file.size) {
      await fs.unlink(req.file.path);
      throw new AppError(422, 'EMPTY_AVATAR', 'A fotografia recebida está vazia. Seleciona-a novamente.');
    }
    
    console.log('UPLOAD AVATAR:', {
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path,
  });

    
    res.json({ success: true, data: await userService.updateAvatar(req.user.id, req.file.filename) });
  }
};
