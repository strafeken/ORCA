/**
 * INTEGRATION tests for the read/authenticated routes:
 *   - routes/health.js       (liveness — no auth)
 *   - routes/experts.js       (FR-06 expert directory; worker-only, SR-25)
 *   - routes/conversations.js (FR-07 messaging; participant scoping, SR-03)
 *
 * These drive real HTTP requests through the full app (route -> authMiddleware
 * -> requireRole -> controller -> service -> mocked DB). Only the DB pool and
 * logger I/O boundaries are mocked. A helper forges a valid bearer token and a
 * matching live session so the auth middleware admits the request, letting us
 * verify the RBAC and access-control wiring end to end.
 */
process.env.JWT_SECRET = 'integration-test-secret-1234567890';
process.env.CSRF_SECRET = 'integration-test-csrf-secret-1234567890';
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();
jest.mock('../db/pool', () => {
  const p = { query: mockQuery, promise: () => ({ query: mockQuery }) };
  return p;
});
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  audit: { log: jest.fn() },
  httpLogger: (req, res, next) => next(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

// Forge a valid access token for a user of the given role.
function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// Configure the mocked DB so the authMiddleware session lookup succeeds and
// route queries return the supplied rows. `sessionOk` controls whether the
// bearer token maps to a live session.
function configureDb({ rows = [], sessionOk = true } = {}) {
  mockQuery.mockImplementation((sql) => {
    // authMiddleware: SELECT ... FROM sessions WHERE token_hash = ?
    if (/FROM sessions/i.test(sql)) {
      return Promise.resolve([
        sessionOk ? [{ id: 1, last_activity: new Date() }] : [],
      ]);
    }
    if (/UPDATE sessions/i.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    // Any other SELECT returns the caller-supplied rows.
    if (/^\s*SELECT/i.test(sql)) return Promise.resolve([rows]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

afterEach(() => jest.clearAllMocks());

describe('routes/health (liveness)', () => {
  test('GET /api/health returns 200 and a status payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/up/i);
  });
});

describe('routes/experts (FR-06, SR-25)', () => {
  test('rejects an unauthenticated request with 401', async () => {
    configureDb({});
    const res = await request(app).get('/api/experts');
    expect(res.status).toBe(401);
  });

  test('forbids a non-worker role with 403 (RBAC, SR-25)', async () => {
    configureDb({ sessionOk: true });
    const token = tokenFor({ id: 9, role: 'expert' }); // experts can't browse the directory
    const res = await request(app).get('/api/experts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('returns the expert directory for an authenticated worker', async () => {
    configureDb({ rows: [{ id: 3, name: 'Bob', bio: 'Structural expert' }] });
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/experts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.experts).toBeDefined();
  });
});

describe('routes/conversations (FR-07, SR-03)', () => {
  test('rejects an unauthenticated list request with 401', async () => {
    configureDb({});
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  test('lists conversations for an authenticated participant', async () => {
    configureDb({ rows: [] });
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('rejects fetching a conversation with an invalid id (SR-07)', async () => {
    configureDb({ rows: [] });
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/conversations/notanumber').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test('returns 404 for a conversation the user is not part of (SR-03)', async () => {
    configureDb({ rows: [] }); // no participant row found
    const token = tokenFor({ id: 1, role: 'worker' });
    const res = await request(app).get('/api/conversations/5').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
