const { randomBytes } = require('crypto');
process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
process.env.CSRF_SECRET = process.env.CSRF_SECRET || randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({
  promise: () => ({ query: mockQuery }),
}));
jest.mock('../utils/mailer', () => ({
  sendActionEmail: jest.fn().mockResolvedValue(true),
}));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  audit: { log: jest.fn() },
  httpLogger: (req, res, next) => next(),
}));
jest.mock('../utils/oneTimeTokens', () => ({
  issueToken: jest.fn(),
  consumeToken: jest.fn(),
  peekToken: jest.fn(),
}));
jest.mock('../utils/totp', () => ({
  setupTotp: jest.fn(),
  confirmTotp: jest.fn(),
  verifyTotp: jest.fn(),
  hasTotp: jest.fn(),
  disableTotp: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const app = require('../app');
const {
  issueToken,
  consumeToken,
  peekToken,
} = require('../utils/oneTimeTokens');
const {
  setupTotp,
  confirmTotp,
  verifyTotp,
  hasTotp,
  disableTotp,
} = require('../utils/totp');

async function csrfPost(pathUrl, body, bearer) {
  const tokenRes = await request(app).get('/api/csrf-token');
  const csrf = tokenRes.body.csrfToken;
  const cookieHeader = (tokenRes.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  let req = request(app)
    .post(pathUrl)
    .set('Cookie', cookieHeader)
    .set('x-csrf-token', csrf)
    .send(body);
  if (bearer) req = req.set('Authorization', `Bearer ${bearer}`);
  return req;
}

function authToken(user = { id: 5, role: 'worker', name: 'Jane' }) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function configureSessionDb() {
  mockQuery.mockImplementation((sql) => {
    if (/FROM sessions/i.test(sql)) {
      return Promise.resolve([[{ id: 1, last_activity: new Date() }]]);
    }
    if (/UPDATE sessions/i.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    if (/^\s*SELECT/i.test(sql)) return Promise.resolve([[]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

afterEach(() => jest.clearAllMocks());

describe('GET /api/auth/verify-email', () => {
  test('rejects an invalid or expired token', async () => {
    consumeToken.mockResolvedValue(null);
    const res = await request(app).get('/api/auth/verify-email?token=bad');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  test('marks the user verified when the token is valid', async () => {
    consumeToken.mockResolvedValue(42);
    mockQuery.mockResolvedValue([{ affectedRows: 1 }]);
    const res = await request(app).get('/api/auth/verify-email?token=good');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
  });
});

describe('POST /api/auth/forgot-password', () => {
  test('returns the same generic message for unknown emails', async () => {
    mockQuery.mockResolvedValue([[]]);
    const res = await csrfPost('/api/auth/forgot-password', { email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/i);
  });

  test('issues a reset token when the account exists', async () => {
    mockQuery.mockResolvedValue([[{ id: 3, name: 'Jane' }]]);
    issueToken.mockResolvedValue('reset-token');
    const res = await csrfPost('/api/auth/forgot-password', { email: 'jane@example.com' });
    expect(res.status).toBe(200);
    expect(issueToken).toHaveBeenCalledWith('reset', 3);
  });
});

describe('POST /api/auth/reset-password', () => {
  test('rejects an invalid reset token', async () => {
    peekToken.mockResolvedValue(null);
    const res = await csrfPost('/api/auth/reset-password', {
      token: 'bad',
      password: 'NewValidPass99!',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  test('rejects reusing the current password', async () => {
    const hash = await argon2.hash('OldValidPass99!');
    peekToken.mockResolvedValue(7);
    mockQuery.mockResolvedValue([[{ password_hash: hash }]]);
    const res = await csrfPost('/api/auth/reset-password', {
      token: 'good',
      password: 'OldValidPass99!',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different from your previous password/i);
  });

  test('updates the password when the token and password are valid', async () => {
    const hash = await argon2.hash('OldValidPass99!');
    peekToken.mockResolvedValue(7);
    consumeToken.mockResolvedValue(7);
    mockQuery.mockImplementation((sql) => {
      if (/SELECT password_hash/i.test(sql)) return Promise.resolve([[{ password_hash: hash }]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    const res = await csrfPost('/api/auth/reset-password', {
      token: 'good',
      password: 'BrandNewPass99!',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated/i);
    expect(consumeToken).toHaveBeenCalledWith('reset', 'good');
  });
});

describe('TOTP routes (/api/auth/totp/*)', () => {
  test('POST /totp/setup returns a QR payload for an authenticated user', async () => {
    configureSessionDb();
    setupTotp.mockResolvedValue({ qrDataUrl: 'data:image/png;base64,abc' });
    const res = await csrfPost('/api/auth/totp/setup', {}, authToken());
    expect(res.status).toBe(200);
    expect(res.body.qr).toBe('data:image/png;base64,abc');
  });

  test('POST /totp/enable rejects an invalid code', async () => {
    configureSessionDb();
    verifyTotp.mockResolvedValue(false);
    const res = await csrfPost('/api/auth/totp/enable', { totp: '000000' }, authToken());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid code/i);
  });

  test('POST /totp/enable confirms the secret when the code is valid', async () => {
    configureSessionDb();
    verifyTotp.mockResolvedValue(true);
    const res = await csrfPost('/api/auth/totp/enable', { totp: '123456' }, authToken());
    expect(res.status).toBe(200);
    expect(confirmTotp).toHaveBeenCalledWith(5);
  });

  test('POST /totp/disable requires a valid code when 2FA is enabled', async () => {
    configureSessionDb();
    hasTotp.mockResolvedValue(true);
    verifyTotp.mockResolvedValue(false);
    const res = await csrfPost('/api/auth/totp/disable', { totp: '000000' }, authToken());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid code/i);
  });

  test('POST /totp/disable removes 2FA when the code is valid', async () => {
    configureSessionDb();
    hasTotp.mockResolvedValue(true);
    verifyTotp.mockResolvedValue(true);
    const res = await csrfPost('/api/auth/totp/disable', { totp: '123456' }, authToken());
    expect(res.status).toBe(200);
    expect(disableTotp).toHaveBeenCalledWith(5);
  });
});
