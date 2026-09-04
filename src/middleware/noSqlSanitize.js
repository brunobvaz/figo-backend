import { AppError } from '../utils/AppError.js';

const hasUnsafeKey = (value) => {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => key.startsWith('$') || key.includes('.') || hasUnsafeKey(nested));
};

export const noSqlSanitize = (req, _res, next) => {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
    return next(new AppError(400, 'INVALID_INPUT', 'O pedido contém campos inválidos.'));
  }
  next();
};
