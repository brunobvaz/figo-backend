import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6, fields: 25, fieldSize: 20 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.includes(file.mimetype)) return callback(new AppError(422, 'INVALID_PRODUCT_IMAGE_TYPE', 'A imagem deve ser JPEG, PNG ou WebP.'));
    callback(null, true);
  }
}).fields([{ name: 'images', maxCount: 6 }, { name: 'image', maxCount: 1 }]);

export const uploadProductImage = (req, res, next) => upload(req, res, error => {
  if (error?.name === 'MulterError') return next(new AppError(422, 'PRODUCT_UPLOAD_ERROR', error.code === 'LIMIT_FILE_SIZE' ? 'Cada fotografia pode ter até 5 MB.' : ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code) ? 'Podes adicionar até 6 fotografias no campo images.' : 'Não foi possível carregar as fotografias.'));
  if (!error && req.files?.images?.length && req.files?.image?.length) return next(new AppError(422, 'AMBIGUOUS_PRODUCT_IMAGES', 'Usa apenas o campo images para as fotografias.'));
  next(error);
});
