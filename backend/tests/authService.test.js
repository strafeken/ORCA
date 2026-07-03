process.env.JWT_SECRET = 'test-secret-for-jest-only-1234567890';

// ---- Mock all external dependencies BEFORE requiring authService ----

// Mock the DB pool. authService does `require('../db/pool').promise()`, so the
// mock must expose a promise() that returns an object with query().
const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({
  promise: () => ({ query: mockQuery }),
}));

// Mock password verification so we control match/no-match deterministically.
jest.mock('../utils/password', () => ({
  verifyPassword: jest.fn(),
}));

// Mock token helpers used by createSession (not central to lockout tests).
jest.mock('../utils/tokens', () => ({
  issueAccessToken: jest.fn(() => 'access.token.jwt'),
  generateRefreshToken: jest.fn(() => 'refreshtoken'),
  hashToken: jest.fn((t) => `hash(${t})`),
  refreshExpiryDate: jest.fn(() => new Date(Date.now() + 3600000)),
}));

// Mock the audit logger so tests don't hit winston/loki.
jest.mock('../utils/winstonLogger', () => ({
  audit: { log: jest.fn() },
  system: { info: jest.fn(), error: jest.fn() },
}));

const { verifyPassword } = require('../utils/password');
const { authenticateUser, AuthResult } = require('../utils/authService');

// Helper to build a user row as the DB would return it.
function makeUser(overrides = {}) {
  return {
    id: 1,
    email: 'john@orca.com',
    name: 'John Doe',
    role: 'worker',
    password_hash: '$argon2id$fake',
    is_verified: 1,
    is_approved: 1,
    is_soft_locked: 0,
    soft_lock_until: null,
    is_hard_locked: 0,
    failed_attempts: 0,
    ...overrides,
  };
}

// Make pool.query return a user row for the first SELECT, and succeed for
// any subsequent UPDATE/INSERT.
function mockUserLookup(user) {
  mockQuery.mockImplementation((sql) => {
    if (/^SELECT/i.test(sql.trim())) return Promise.resolve([user ? [user] : []]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

describe('authenticateUser', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns SUCCESS with correct password on a healthy account', async () => {
    mockUserLookup(makeUser());
    verifyPassword.mockResolvedValue(true);
    const { result, user } = await authenticateUser('john@orca.com', 'right');
    expect(result).toBe(AuthResult.SUCCESS);
    expect(user.email).toBe('john@orca.com');
  });

  test('returns INVALID_CREDENTIALS for a wrong password', async () => {
    mockUserLookup(makeUser());
    verifyPassword.mockResolvedValue(false);
    const { result } = await authenticateUser('john@orca.com', 'wrong');
    expect(result).toBe(AuthResult.INVALID_CREDENTIALS);
  });

  test('returns INVALID_CREDENTIALS for an unknown email (no enumeration)', async () => {
    mockUserLookup(null); // no user found
    verifyPassword.mockResolvedValue(false);
    const { result } = await authenticateUser('nobody@orca.com', 'x');
    expect(result).toBe(AuthResult.INVALID_CREDENTIALS);
    // It still calls verifyPassword against a dummy hash to keep timing uniform.
    expect(verifyPassword).toHaveBeenCalled();
  });

  test('unverified account is blocked even with the correct password', async () => {
    mockUserLookup(makeUser({ is_verified: 0 }));
    verifyPassword.mockResolvedValue(true);
    const { result } = await authenticateUser('john@orca.com', 'right');
    expect(result).toBe(AuthResult.NOT_VERIFIED);
  });

  test('unapproved expert is blocked even with the correct password', async () => {
    mockUserLookup(makeUser({ role: 'expert', is_approved: 0 }));
    verifyPassword.mockResolvedValue(true);
    const { result } = await authenticateUser('bob@orca.com', 'right');
    expect(result).toBe(AuthResult.NOT_APPROVED);
  });

  test('hard-locked account is rejected before password check', async () => {
    mockUserLookup(makeUser({ is_hard_locked: 1 }));
    verifyPassword.mockResolvedValue(true);
    const { result } = await authenticateUser('john@orca.com', 'right');
    expect(result).toBe(AuthResult.HARD_LOCKED);
  });

  test('active soft-lock rejects even the correct password', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000); // 10 min ahead
    mockUserLookup(makeUser({ is_soft_locked: 1, soft_lock_until: future }));
    verifyPassword.mockResolvedValue(true);
    const { result } = await authenticateUser('john@orca.com', 'right');
    expect(result).toBe(AuthResult.SOFT_LOCKED);
  });

  test('expired soft-lock lets a correct password through', async () => {
    const past = new Date(Date.now() - 60 * 1000); // 1 min ago
    mockUserLookup(makeUser({ is_soft_locked: 1, soft_lock_until: past }));
    verifyPassword.mockResolvedValue(true);
    const { result } = await authenticateUser('john@orca.com', 'right');
    expect(result).toBe(AuthResult.SUCCESS);
  });
});

/**
 * SR-22: distinct soft lockout (time-based) and hard lockout (Admin-reset).
 * A wrong password runs registerFailedAttempt, which escalates the account
 * state based on the running failed_attempts counter. We assert the exact
 * UPDATE issued at each threshold.
 */
describe('failed-attempt lockout escalation (SR-22)', () => {
  afterEach(() => jest.clearAllMocks());

  // Capture the UPDATE that registerFailedAttempt issues after a wrong password.
  function lastUpdate() {
    return mockQuery.mock.calls
      .map((c) => ({ sql: c[0], params: c[1] }))
      .reverse()
      .find((c) => /UPDATE users/i.test(c.sql));
  }

  test('below threshold: only increments the counter, no lock', async () => {
    mockUserLookup(makeUser({ failed_attempts: 2 }));
    verifyPassword.mockResolvedValue(false);
    await authenticateUser('john@orca.com', 'wrong');
    const upd = lastUpdate();
    expect(upd.sql).toMatch(/failed_attempts = \?/);
    expect(upd.sql).not.toMatch(/is_soft_locked/);
    expect(upd.sql).not.toMatch(/is_hard_locked/);
    expect(upd.params[0]).toBe(3); // 2 + 1
  });

  test('crossing 5 failures sets the soft lock with a future expiry', async () => {
    mockUserLookup(makeUser({ failed_attempts: 4 })); // this attempt makes 5
    verifyPassword.mockResolvedValue(false);
    await authenticateUser('john@orca.com', 'wrong');
    const upd = lastUpdate();
    expect(upd.sql).toMatch(/is_soft_locked = TRUE/);
    expect(upd.params[0]).toBe(5);
    // soft_lock_until is the 2nd param and must be in the future.
    expect(new Date(upd.params[1]).getTime()).toBeGreaterThan(Date.now());
  });

  test('crossing 10 failures sets the hard lock (Admin-reset required)', async () => {
    mockUserLookup(makeUser({ failed_attempts: 9 })); // this attempt makes 10
    verifyPassword.mockResolvedValue(false);
    await authenticateUser('john@orca.com', 'wrong');
    const upd = lastUpdate();
    expect(upd.sql).toMatch(/is_hard_locked = TRUE/);
    expect(upd.params[0]).toBe(10);
  });
});

/**
 * createSession: stores only hashes of the tokens (SR-18 — tokens never
 * persisted in raw form) plus source IP / user agent for the admin session view.
 */
describe('createSession', () => {
  const { createSession } = require('../utils/authService');
  afterEach(() => jest.clearAllMocks());

  test('inserts a session and returns raw tokens to the caller', async () => {
    mockQuery.mockResolvedValue([{ insertId: 1 }]);
    const user = { id: 1, name: 'John', role: 'worker' };
    const out = await createSession(user, { ip: '1.2.3.4', userAgent: 'jest' });

    expect(out.accessToken).toBe('access.token.jwt');
    expect(out.refreshToken).toBe('refreshtoken');

    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO sessions/i.test(c[0]));
    expect(insert).toBeDefined();
    // Stored values are HASHES of the tokens, not the raw tokens (SR-18).
    expect(insert[1]).toContain('hash(access.token.jwt)');
    expect(insert[1]).toContain('hash(refreshtoken)');
    // Metadata recorded for the admin session view.
    expect(insert[1]).toContain('1.2.3.4');
    expect(insert[1]).toContain('jest');
  });
});

/**
 * Session revocation (SR-18: all tokens invalidated on logout). Both helpers
 * mark the matching session row revoked by the token's hash.
 */
describe('session revocation', () => {
  const {
    revokeSessionByRefreshToken,
    revokeSessionByAccessToken,
  } = require('../utils/authService');
  afterEach(() => jest.clearAllMocks());

  test('revokeSessionByRefreshToken marks the row revoked by refresh hash', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await revokeSessionByRefreshToken('sometoken');
    const call = mockQuery.mock.calls.find((c) => /UPDATE sessions/i.test(c[0]));
    expect(call[0]).toMatch(/revoked = TRUE/i);
    expect(call[0]).toMatch(/refresh_token_hash/i);
    expect(call[1]).toContain('hash(sometoken)');
  });

  test('revokeSessionByAccessToken marks the row revoked by access hash', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await revokeSessionByAccessToken('accesstok');
    const call = mockQuery.mock.calls.find((c) => /UPDATE sessions/i.test(c[0]));
    expect(call[0]).toMatch(/revoked = TRUE/i);
    expect(call[1]).toContain('hash(accesstok)');
  });
});
