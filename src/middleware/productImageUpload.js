import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
export const uploadProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.includes(file.mimetype)) return callback(new AppError(422, 'INVALID_PRODUCT_IMAGE_TYPE', 'A imagem deve ser JPEG, PNG ou WebP.'));
    callback(null, true);
  }
}).single('image');
