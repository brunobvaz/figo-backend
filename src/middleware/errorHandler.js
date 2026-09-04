import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

export const notFound = (req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', `Rota não encontrada: ${req.method} ${req.originalUrl}`));

export const errorHandler = (error, _req, res, _next) => {
  let normalized = error;
  if (error instanceof ZodError) {
    normalized = new AppError(422, 'VALIDATION_ERROR', 'Os dados enviados são inválidos.', error.issues.map((issue) => ({ field: issue.path.slice(1).join('.'), message: issue.message })));
  } else if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'campo';
    normalized = new AppError(409, 'RESOURCE_ALREADY_EXISTS', `Já existe um registo com este ${field}.`);
  } else if (error?.name === 'CastError') {
    normalized = new AppError(400, 'INVALID_IDENTIFIER', 'Identificador inválido.');
  } else if (error?.name === 'MulterError') {
    normalized = new AppError(422, 'AVATAR_UPLOAD_ERROR', error.code === 'LIMIT_FILE_SIZE' ? 'A fotografia não pode exceder 5 MB.' : 'Não foi possível carregar a fotografia.');
  }
  const status = normalized.statusCode || 500;
  if (status >= 500) console.error(error);
  const body = { success: false, error: { code: normalized.code || 'INTERNAL_ERROR', message: normalized.isOperational ? normalized.message : 'Ocorreu um erro inesperado.' } };
  if (normalized.details) body.error.details = normalized.details;
  if (env.NODE_ENV !== 'production' && status >= 500) body.error.stack = error.stack;
  res.status(status).json(body);
};
