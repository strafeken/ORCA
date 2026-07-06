/**
 * INTEGRATION tests for routes/users.js — profile CRUD and account security.
 *
 * Maps to:
 *   FR-03 view own profile        (GET /me)
 *   FR-04 update own profile      (PATCH /me) + re-auth before password change
 *   SR-12 mass-assignment guard   (role / is_verified are NOT accepted via /me)
 *   FR-04 re-authentication       (POST /me/reauth)
 *   FR-05 delete restrictions     (admins cannot self-delete)
 *
 * Real requests flow through authMiddleware; the DB pool and mailer/logger are
 * mocked at the boundary. CSRF applies to mutating requests, so those use the
 * csrfRequest helper which forwards the double-submit cookie (SR-28).
 */
// Generate ephemeral test secrets at runtime (no hardcoded secret literals
// for the secret scanner to flag; these never leave the test process).
const { randomBytes } = require('crypto');
process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
process.env.CSRF_SECRET = process.env.CSRF_SECRET || randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({ query: mockQuery, promise: () => ({ query: mockQuery }) }));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  audit: { log: jest.fn() },
  httpLogger: (req, res, next) => next(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const app = require('../app');

// Explicit method dispatch avoids dynamic property access (which the SAST rule
// security/detect-object-injection flags) while keeping the helpers generic.
function dispatch(method, pathUrl) {
  const r = request(app);
  if (method === 'get') return r.get(pathUrl);
  if (method === 'post') return r.post(pathUrl);
  if (method === 'patch') return r.patch(pathUrl);
  if (method === 'put') return r.put(pathUrl);
  if (method === 'delete') return r.delete(pathUrl);
  throw new Error('unsupported method: ' + method);
}

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// A CSRF-aware mutating request that also carries the bearer token. Forwards
// the secure double-submit cookie over the HTTP test transport.
async function csrfRequest(method, pathUrl, token, body) {
  const tokenRes = await request(app).get('/api/csrf-token');
  const csrf = tokenRes.body.csrfToken;
  const cookie = (tokenRes.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  return dispatch(method, pathUrl)
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrf)
    .send(body);
}

// Session lookup for authMiddleware succeeds; other queries return `rows`.
function configureDb(rows = []) {
  mockQuery.mockImplementation((sql) => {
    if (/FROM sessions/i.test(sql)) return Promise.resolve([[{ id: 1, last_activity: new Date() }]]);
    if (/UPDATE sessions/i.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    if (/^\s*SELECT/i.test(sql)) return Promise.resolve([rows]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

afterEach(() => jest.clearAllMocks());

describe('GET /api/users/me (FR-03)', () => {
  test('rejects an unauthenticated request', async () => {
    configureDb([]);
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  test('returns the profile for an authenticated user', async () => {
    configureDb([{ id: 1, name: 'John', email: 'john@orca.com', role: 'worker' }]);
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('john@orca.com');
  });
});

describe('PATCH /api/users/me (FR-04, SR-12 mass-assignment guard)', () => {
  test('rejects an update that only contains non-allowlisted fields (SR-12)', async () => {
    configureDb([]);
    const token = tokenFor({ id: 1, role: 'worker' });
    // role and is_verified are security-sensitive and must NOT be mass-assignable.
    const res = await csrfRequest('patch', '/api/users/me', token, { role: 'admin', is_verified: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no updatable fields/i);
  });

  test('accepts an update to an allowlisted field (e.g. bio)', async () => {
    configureDb([{ id: 1, name: 'John', email: 'john@orca.com', role: 'worker', bio: 'updated' }]);
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await csrfRequest('patch', '/api/users/me', token, { bio: 'updated' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/users/me/reauth (FR-04 re-authentication)', () => {
  test('requires a password in the body', async () => {
    configureDb([]);
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await csrfRequest('post', '/api/users/me/reauth', token, {});
    expect(res.status).toBe(400);
  });

  test('rejects an incorrect current password with 403', async () => {
    const hash = await argon2.hash('CorrectPass123!');
    configureDb([{ password_hash: hash }]);
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await csrfRequest('post', '/api/users/me/reauth', token, { password: 'WrongPass123!' });
    expect(res.status).toBe(403);
  });

  test('accepts the correct current password', async () => {
    const hash = await argon2.hash('CorrectPass123!');
    configureDb([{ password_hash: hash }]);
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await csrfRequest('post', '/api/users/me/reauth', token, { password: 'CorrectPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('DELETE /api/users/me (FR-05 restrictions)', () => {
  test('forbids an admin from deleting their own account', async () => {
    configureDb([]);
    const token = tokenFor({ id: 1, role: 'admin' });
    const res = await csrfRequest('delete', '/api/users/me', token, { password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot delete their own account/i);
  });
});
