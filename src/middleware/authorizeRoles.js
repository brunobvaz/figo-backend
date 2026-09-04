import { AppError } from '../utils/AppError.js';

export const authorizeRoles = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.some((role) => req.user.roles.includes(role))) {
    return next(new AppError(403, 'AUTH_FORBIDDEN', 'Não tens permissão para realizar esta ação.'));
  }
  next();
};
