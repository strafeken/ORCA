const request = require('supertest');
const express = require('express');

// Mock verifyToken BEFORE requiring rateLimiter, since rateLimiter.js
// requires it at module load time.
jest.mock('../utils/tokens', () => ({
  verifyToken: jest.fn(),
}));
const { verifyToken } = require('../utils/tokens');
const { globalLimiter, keyGenerator } = require('../middleware/rateLimiter');

describe('keyGenerator (unit)', () => {
  afterEach(() => jest.clearAllMocks());

  test('keys by user ID when Authorization has a valid bearer token', () => {
    verifyToken.mockReturnValue({ id: 42 });
    const req = {
      headers: { authorization: 'Bearer validtoken' },
      ip: '1.2.3.4',
    };
    expect(keyGenerator(req)).toBe('user:42');
  });

  test('falls back to IP when token verification throws', () => {
    verifyToken.mockImplementation(() => { throw new Error('invalid'); });
    const req = {
      headers: { authorization: 'Bearer garbage' },
      ip: '5.6.7.8',
    };
    expect(keyGenerator(req)).toBe('5.6.7.8');
  });

  test('falls back to IP when no Authorization header is present', () => {
    const req = { headers: {}, ip: '9.9.9.9' };
    expect(keyGenerator(req)).toBe('9.9.9.9');
  });

  test('falls back to IP when verifyToken returns no id', () => {
    verifyToken.mockReturnValue({});
    const req = {
      headers: { authorization: 'Bearer weird' },
      ip: '10.0.0.1',
    };
    expect(keyGenerator(req)).toBe('10.0.0.1');
  });

  test('does not trust a decoded token missing an id even if truthy', () => {
    verifyToken.mockReturnValue({ id: null });
    const req = {
      headers: { authorization: 'Bearer weird2' },
      ip: '10.0.0.2',
    };
    expect(keyGenerator(req)).toBe('10.0.0.2');
  });

  test('normalizes IPv6 fallback via ipKeyGenerator (not raw req.ip)', () => {
    const req = {
      headers: {},
      ip: '2001:db8::1',
    };
    const key = keyGenerator(req);
    // ipKeyGenerator returns a CIDR-notation subnet string for IPv6,
    // not the raw address — asserting it's NOT the raw IP is what
    // actually catches a regression back to `return req.ip`.
    expect(key).not.toBe('2001:db8::1');
    expect(typeof key).toBe('string');
  });
});

describe('globalLimiter (integration, via supertest)', () => {
  function buildApp() {
    const app = express();
    app.use(globalLimiter);
    app.get('/api/auth/session', (req, res) => res.json({ ok: true }));
    app.get('/api/whatever', (req, res) => res.json({ ok: true }));
    return app;
  }

  test('skips rate limiting for GET /api/auth/session', async () => {
    const app = buildApp();
    // Fire more than `max` requests at the skipped route; none should 429.
    for (let i = 0; i < 105; i++) {
      const res = await request(app).get('/api/auth/session');
      expect(res.status).toBe(200);
    }
  });

  test('rate-limits a normal route after exceeding max', async () => {
    const app = buildApp();
    let lastStatus;
    for (let i = 0; i < 101; i++) {
      const res = await request(app).get('/api/whatever');
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
