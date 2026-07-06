/**
 * INTEGRATION tests for the remaining route groups:
 *   - routes/authExtras.js  (FR-01/02, SR-02/19/21: verify-email, forgot/reset
 *                             password, TOTP setup) — public + authed
 *   - routes/files.js       (FR-08 upload; participant-guarded, SR-04)
 *   - routes/annotations.js (FR-09 annotation; participant-guarded, SR-08)
 *   - routes/voip.js        (FR-11 video call; worker/expert only, SR-04)
 *
 * The guarded media routes share the pattern authMiddleware -> requireRole ->
 * loadConversationId -> requireParticipant, so the key security assertion is
 * that unauthenticated / non-participant callers are rejected before any file
 * or signalling data is exposed.
 */
// Generate ephemeral test secrets at runtime (no hardcoded secret literals
// for the secret scanner to flag; these never leave the test process).
const { randomBytes } = require('crypto');
process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
process.env.CSRF_SECRET = process.env.CSRF_SECRET || randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({ query: mockQuery, promise: () => ({ query: mockQuery }) }));
jest.mock('../utils/mailer', () => ({ sendActionEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('../utils/oneTimeTokens', () => ({
  issueToken: jest.fn().mockResolvedValue('rawtoken123'),
  consumeToken: jest.fn(),
}));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  audit: { log: jest.fn() },
  httpLogger: (req, res, next) => next(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '15m' });
}
async function csrfPost(pathUrl, token, body) {
  const t = await request(app).get('/api/csrf-token');
  const cookie = (t.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const req = request(app).post(pathUrl).set('Cookie', cookie).set('x-csrf-token', t.body.csrfToken);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
}
function configureDb(rows = []) {
  mockQuery.mockImplementation((sql) => {
    if (/FROM sessions/i.test(sql)) return Promise.resolve([[{ id: 1, last_activity: new Date() }]]);
    if (/UPDATE sessions/i.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    if (/^\s*SELECT/i.test(sql)) return Promise.resolve([rows]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

afterEach(() => jest.clearAllMocks());

describe('authExtras public flows (FR-01/02, SR-02/19/21)', () => {
  test('GET /verify-email with no token fails', async () => {
    configureDb([]);
    const res = await request(app).get('/api/auth/verify-email');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('POST /forgot-password returns a generic success (anti-enumeration)', async () => {
    configureDb([]);
    const res = await csrfPost('/api/auth/forgot-password', null, { email: 'someone@orca.com' });
    // Always a non-revealing success/accepted response regardless of existence.
    expect([200, 202]).toContain(res.status);
  });

  test('POST /reset-password with a missing/invalid token is rejected', async () => {
    configureDb([[]]); // token lookup finds nothing
    const res = await csrfPost('/api/auth/reset-password', null, { token: 'bad', password: 'NewValidPass123!' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('POST /totp/setup requires authentication', async () => {
    configureDb([]);
    const res = await csrfPost('/api/auth/totp/setup', null, {});
    expect(res.status).toBe(401);
  });

  test('GET /verify-email with a valid token activates the account (SR-19)', async () => {
    const { consumeToken } = require('../utils/oneTimeTokens');
    consumeToken.mockResolvedValueOnce(42); // token valid -> user id 42
    configureDb([]);
    const res = await request(app).get('/api/auth/verify-email?token=goodtoken');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
  });

  test('GET /verify-email with an invalid token is rejected', async () => {
    const { consumeToken } = require('../utils/oneTimeTokens');
    consumeToken.mockResolvedValueOnce(null); // invalid/expired
    configureDb([]);
    const res = await request(app).get('/api/auth/verify-email?token=badtoken');
    expect(res.status).toBe(400);
  });

  test('POST /resend-verification returns a generic response (anti-enumeration)', async () => {
    configureDb([[]]); // no user found
    const res = await csrfPost('/api/auth/resend-verification', null, { email: 'x@orca.com' });
    expect(res.status).toBe(200);
  });

  test('POST /reset-password with a valid token is processed (SR-02)', async () => {
    const { consumeToken } = require('../utils/oneTimeTokens');
    consumeToken.mockResolvedValueOnce(42); // valid reset token -> user id 42
    configureDb([{ id: 42 }]);
    const res = await csrfPost('/api/auth/reset-password', null, {
      token: 'goodreset', password: 'NewValidPass123!',
    });
    // A valid token gets past the "invalid or expired" 400 branch; the handler
    // then proceeds to update the password (exact success shape varies).
    expect(res.status).not.toBe(400);
  });
});

describe('files routes (FR-08, SR-04 participant guard)', () => {
  test('unauthenticated upload is rejected', async () => {
    configureDb([]);
    const res = await request(app).post('/api/conversations/5/files');
    // A POST with no auth and no CSRF token is blocked — 403 (CSRF, checked
    // first on mutating routes) or 401 (auth). Either means it's protected.
    expect([401, 403]).toContain(res.status);
  });

  test('unauthenticated file listing is rejected', async () => {
    configureDb([]);
    const res = await request(app).get('/api/conversations/5/files');
    expect(res.status).toBe(401);
  });

  test('a non-participant is blocked from a conversation\'s files (SR-04)', async () => {
    // Session ok, but the participant lookup returns empty -> not a participant.
    mockQuery.mockImplementation((sql) => {
      if (/FROM sessions/i.test(sql)) return Promise.resolve([[{ id: 1, last_activity: new Date() }]]);
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve([[]]); // not a participant
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/conversations/5/files').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBeGreaterThanOrEqual(403);
  });
});

describe('annotations routes (FR-09, SR-08 participant guard)', () => {
  test('unauthenticated annotation fetch is rejected', async () => {
    configureDb([]);
    const res = await request(app).get('/api/files/5/annotations');
    expect(res.status).toBe(401);
  });
});

describe('voip routes (FR-11, SR-04)', () => {
  test('unauthenticated TURN-credential request is rejected', async () => {
    configureDb([]);
    const res = await request(app).get('/api/voip/turn-credentials');
    expect(res.status).toBe(401);
  });

  test('an authenticated worker can request TURN credentials', async () => {
    configureDb([]);
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/voip/turn-credentials').set('Authorization', `Bearer ${token}`);
    // Admitted (not blocked). Exact body depends on TURN config.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
