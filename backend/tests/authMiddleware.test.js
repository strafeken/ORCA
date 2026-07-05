process.env.JWT_SECRET = 'test-secret-for-jest-only-1234567890';

// Mock the session repository and token utils so we can drive each branch.
const mockFindByTokenHash = jest.fn();
const mockRevokeById = jest.fn();
const mockTouch = jest.fn();
jest.mock('../repositories/SessionRepository', () => ({
  SessionRepository: jest.fn().mockImplementation(() => ({
    findByTokenHash: mockFindByTokenHash,
    revokeById: mockRevokeById,
    touch: mockTouch,
  })),
}));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
}));

const { verifyToken, hashToken } = require('../utils/tokens');
const {
  authMiddleware,
  requireRole,
  INACTIVITY_TIMEOUT_MS,
} = require('../middleware/authMiddleware');

// Build a valid token for a user so the JWT step passes.
const jwt = require('jsonwebtoken');
function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function mockReqRes(headers = {}) {
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = { headers, user: null };
  const next = jest.fn();
  return { req, res, next };
}

describe('authMiddleware (SR-18 session validation)', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects a request with no Authorization header', async () => {
    const { req, res, next } = mockReqRes({});
    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a malformed / invalid token', async () => {
    const { req, res, next } = mockReqRes({ authorization: 'Bearer not.a.jwt' });
    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects when the session has been revoked (no row found)', async () => {
    const token = tokenFor({ id: 1, role: 'worker' });
    mockFindByTokenHash.mockResolvedValue(null); // revoked / not found
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  test('expires and revokes a session idle beyond the inactivity timeout', async () => {
    const token = tokenFor({ id: 1, role: 'worker' });
    const stale = new Date(Date.now() - INACTIVITY_TIMEOUT_MS - 1000);
    mockFindByTokenHash.mockResolvedValue({ id: 55, last_activity: stale });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    await authMiddleware(req, res, next);
    expect(mockRevokeById).toHaveBeenCalledWith(55);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/inactivity/i);
  });

  test('accepts a live session, sets req.user, and touches the session', async () => {
    const token = tokenFor({ id: 7, role: 'expert' });
    mockFindByTokenHash.mockResolvedValue({ id: 88, last_activity: new Date() });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    await authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(7);
    expect(mockTouch).toHaveBeenCalledWith(88);
  });

  test('fails closed (500) if the session DB check throws', async () => {
    const token = tokenFor({ id: 1, role: 'worker' });
    mockFindByTokenHash.mockRejectedValue(new Error('db down'));
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    await authMiddleware(req, res, next);
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole (SR-25 server-side RBAC)', () => {
  test('allows a user whose role is permitted', () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: 1, role: 'admin' };
    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('forbids a user whose role is not permitted', () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: 1, role: 'worker' };
    requireRole('admin')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('forbids when there is no authenticated user', () => {
    const { req, res, next } = mockReqRes();
    req.user = null;
    requireRole('admin')(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  test('supports multiple allowed roles', () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: 1, role: 'expert' };
    requireRole('worker', 'expert')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
