import { it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLimiter, clientKey } from '../src/middleware/rateLimiters.js';
import { tokenService } from '../src/services/tokenService.js';

it('isolates signed users and logs blocked requests without tokens or raw identities', async () => {
  const app = express();
  app.use(createLimiter('test', { windowMs: 60000, limit: 1, keyGenerator: clientKey }));
  app.get('/', (_req, res) => res.json({ ok: true }));
  const token = id => tokenService.generateAccessToken({ id, roles: [] }, 'session');
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await request(app).get('/').auth(token('alice'), { type: 'bearer' }).expect(200);
    await request(app).get('/').auth(token('bob'), { type: 'bearer' }).expect(200);
    const blocked = await request(app).get('/').auth(token('alice'), { type: 'bearer' }).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(JSON.stringify(log.mock.calls)).not.toContain('alice');
    expect(log.mock.calls[0][1].limiter).toBe('test');
  } finally { log.mockRestore(); }
});

it('falls back to IP for forged tokens', () => {
  expect(clientKey({ headers: { authorization: 'Bearer fake' }, ip: '192.0.2.1', socket: {} })).toBe('ip:192.0.2.1');
});

it('excludes successful requests and separates operation budgets', async () => {
  const app = express();
  app.use(createLimiter('test-auth', { windowMs: 60000, limit: 1,
    skipSuccessfulRequests: true, keyGenerator: req => `${clientKey(req)}:${req.path}` }));
  app.get('/ok', (_req, res) => res.end());
  app.get('/fail', (_req, res) => res.status(401).end());
  await request(app).get('/ok').expect(200);
  await request(app).get('/ok').expect(200);
  await request(app).get('/fail').expect(401);
  await request(app).get('/ok').expect(200);
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { await request(app).get('/fail').expect(429); } finally { log.mockRestore(); }
});
