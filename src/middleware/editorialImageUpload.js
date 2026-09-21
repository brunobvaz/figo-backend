import multer from 'multer';
import { AppError } from '../utils/AppError.js';

export function createEditorialImageUpload(errorCode) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const failure = message => new AppError(422, errorCode, message, [{ field: 'image', message }]);
  const upload = multer({
    storage: multer.memoryStorage(),
    // Busboy signals partsLimit when the count reaches it. files/fields still
    // restrict the payload to exactly one photo and one JSON field.
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 128 * 1024, parts: 3 },
    fileFilter: (_req, file, callback) => {
      const accepted = allowedTypes.includes(file.mimetype);
      callback(accepted ? null : failure('A fotografia deve ser JPEG, PNG ou WebP.'), accepted);
    }
  }).single('image');
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    upload(req, res, error => {
      if (error) return next(error instanceof AppError ? error : failure(error.code === 'LIMIT_FILE_SIZE' ? 'A fotografia pode ter até 5 MB.' : 'Envia apenas uma fotografia e os dados.'));
      if (Object.keys(req.body || {}).length !== 1 || typeof req.body.data !== 'string') return next(failure('Envia os dados no campo data.'));
      try { req.body = JSON.parse(req.body.data); }
      catch { return next(failure('Os dados não são JSON válido.')); }
      if (req.file && req.body && typeof req.body === 'object' && !Array.isArray(req.body) && !Object.hasOwn(req.body, 'image')) req.body.image = null;
      next();
    });
  };
}
