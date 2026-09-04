import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

function sign(payload, secret, expiresIn) {
  return jwt.sign(payload, secret, { expiresIn, algorithm: 'HS256' });
}

export const tokenService = {
  generateAccessToken(user, sessionId) {
    return sign({ sub: user.id, roles: user.roles, sid: sessionId }, env.JWT_ACCESS_SECRET, env.JWT_ACCESS_EXPIRES_IN);
  },
  generateRefreshToken(user, sessionId) {
    return sign({ sub: user.id, sid: sessionId, type: 'refresh' }, env.JWT_REFRESH_SECRET, env.JWT_REFRESH_EXPIRES_IN);
  },
  verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  },
  verifyRefreshToken(token) {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    if (payload.type !== 'refresh') throw new jwt.JsonWebTokenError('Tipo de token inválido');
    return payload;
  },
  expirationDate(token) {
    const payload = jwt.decode(token);
    return new Date(payload.exp * 1000);
  }
};
