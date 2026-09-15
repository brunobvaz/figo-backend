import { userService } from '../services/userService.js';
import fs from 'node:fs/promises';
import { AppError } from '../utils/AppError.js';

export const userController = {
  async updateMe(req, res) {
    res.json({ success: true, data: await userService.updateMe(req.user.id, req.body) });
  },
  async updateAvatar(req, res) {
    if (!req.file) return res.status(422).json({ success: false, error: { code: 'AVATAR_REQUIRED', message: 'Seleciona uma fotografia.' } });
    try {
      if (!req.file.size) throw new AppError(422, 'EMPTY_AVATAR', 'A fotografia recebida está vazia. Seleciona-a novamente.');
      res.json({ success: true, data: await userService.updateAvatar(req.user.id, req.file.filename) });
    } catch (error) { await fs.unlink(req.file.path).catch(() => {}); throw error; }
  }
};
