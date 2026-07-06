/**
 * INTEGRATION tests for the authentication routes (routes/auth.js).
 *
 * Unlike the unit tests (which isolate a single function with everything
 * mocked), these drive REAL HTTP requests through the actual Express app —
 * exercising the full path: route -> rate limiter -> middleware -> controller
 * -> service -> (mocked) database -> HTTP response. Only the outermost I/O
 * boundaries are mocked: the MySQL pool and the SMTP mailer. This is what
 * validates that all the layers are wired together correctly (SR-17 auth,
 * SR-18 sessions, SR-19 email verification gate, SR-22 lockout).
 *
 * Test technique: supertest fires requests at the exported app without opening
 * a real network port.
 */
// Generate ephemeral test secrets at runtime (no hardcoded secret literals
// for the secret scanner to flag; these never leave the test process).
const { randomBytes } = require('crypto');
process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
process.env.CSRF_SECRET = process.env.CSRF_SECRET || randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

// --- Mock the outermost I/O boundaries only ---
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

const request = require('supertest');
const argon2 = require('argon2');
const app = require('../app');

// CSRF is enforced via a double-submit cookie (SR-28). The cookie is issued
// with `secure: true`, so supertest (plain HTTP) will NOT auto-resend it. We
// therefore read the Set-Cookie header from /api/csrf-token and forward it
// manually on the POST, paired with the token in the x-csrf-token header. The
// session identifier resolves to 'anonymous_context' for both requests (no
// refresh token yet on the auth endpoints), so the pair validates.
async function csrfPost(pathUrl, body) {
  const tokenRes = await request(app).get('/api/csrf-token');
  const csrf = tokenRes.body.csrfToken;
  const setCookie = tokenRes.headers['set-cookie'] || [];
  // Strip the `Secure` attribute so the cookie is accepted back over HTTP test
  // transport; the token value itself is unchanged.
  const cookieHeader = setCookie
    .map((c) => c.split(';')[0])
    .join('; ');
  return request(app)
    .post(pathUrl)
    .set('Cookie', cookieHeader)
    .set('x-csrf-token', csrf)
    .send(body);
}

// Helper: make the mocked pool answer SELECTs with a given user row and
// succeed for writes. Table-aware: the users lookup returns the user, but
// totp_secrets / sessions lookups return empty so the login path doesn't think
// TOTP is enrolled or a duplicate session exists.
function dbReturnsUser(user) {
  mockQuery.mockImplementation((sql) => {
    if (/^\s*SELECT/i.test(sql)) {
      if (/totp_secrets/i.test(sql)) return Promise.resolve([[]]);       // no TOTP enrolled
      if (/COUNT|sessions/i.test(sql)) return Promise.resolve([[{ active: 0, count: 0 }]]); // no live sessions
      return Promise.resolve([user ? [user] : []]);                      // users lookup
    }
    if (/^\s*INSERT/i.test(sql)) return Promise.resolve([{ insertId: 1 }]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

describe('POST /api/auth/register (integration)', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects a password shorter than the policy minimum (400)', async () => {
    dbReturnsUser(null);
    const res = await csrfPost('/api/auth/register', { name: 'Jane', email: 'jane@orca.com', password: 'short', role: 'worker' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/12 characters|password/i);
  });

  test('rejects an invalid email (400)', async () => {
    dbReturnsUser(null);
    const res = await csrfPost('/api/auth/register', { name: 'Jane', email: 'not-an-email', password: 'ValidPass1234', role: 'worker' });
    expect(res.status).toBe(400);
  });

  test('rejects an attempt to self-register as admin (privilege escalation)', async () => {
    dbReturnsUser(null);
    const res = await csrfPost('/api/auth/register', { name: 'X', email: 'x@orca.com', password: 'ValidPass1234', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/worker or expert/i);
  });

  test('accepts a valid worker registration', async () => {
    dbReturnsUser(null);
    const res = await csrfPost('/api/auth/register', { name: 'Jane', email: 'jane@orca.com', password: 'ValidPass1234', role: 'worker' });
    // 201 created (or 202 accepted, depending on the flow) — both are success.
    expect([200, 201, 202]).toContain(res.status);
  });
});

describe('POST /api/auth/login (integration)', () => {
  afterEach(() => jest.clearAllMocks());

  async function userRow(overrides = {}) {
    const hash = await argon2.hash('WorkerPass123!');
    return {
      id: 1, name: 'John', email: 'john@orca.com', role: 'worker',
      password_hash: hash, is_verified: 1, is_approved: 1,
      is_soft_locked: 0, soft_lock_until: null, is_hard_locked: 0,
      failed_attempts: 0, ...overrides,
    };
  }

  test('rejects a wrong password with 401', async () => {
    dbReturnsUser(await userRow());
    const res = await csrfPost('/api/auth/login', { email: 'john@orca.com', password: 'WRONGpassword' });
    expect(res.status).toBe(401);
  });

  test('rejects an unknown email with 401 (no enumeration)', async () => {
    dbReturnsUser(null);
    const res = await csrfPost('/api/auth/login', { email: 'ghost@orca.com', password: 'whatever12345' });
    expect(res.status).toBe(401);
  });

  test('blocks an unverified worker even with the correct password', async () => {
    dbReturnsUser(await userRow({ is_verified: 0 }));
    const res = await csrfPost('/api/auth/login', { email: 'john@orca.com', password: 'WorkerPass123!' });
    // Not a success — the verification gate holds.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('rejects a hard-locked account', async () => {
    dbReturnsUser(await userRow({ is_hard_locked: 1 }));
    const res = await csrfPost('/api/auth/login', { email: 'john@orca.com', password: 'WorkerPass123!' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('succeeds for a verified, approved worker with the correct password', async () => {
    dbReturnsUser(await userRow());
    const res = await csrfPost('/api/auth/login', { email: 'john@orca.com', password: 'WorkerPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

describe('POST /api/auth/admin/login (integration)', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects a non-admin on the admin endpoint', async () => {
    const hash = await argon2.hash('WorkerPass123!');
    dbReturnsUser({
      id: 1, name: 'John', email: 'john@orca.com', role: 'worker',
      password_hash: hash, is_verified: 1, is_approved: 1,
      is_soft_locked: 0, soft_lock_until: null, is_hard_locked: 0, failed_attempts: 0,
    });
    const res = await csrfPost('/api/auth/admin/login', { email: 'john@orca.com', password: 'WorkerPass123!' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
