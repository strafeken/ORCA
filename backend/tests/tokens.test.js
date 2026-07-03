// tokens.js reads JWT_SECRET at module load and refuses to start without it,
// so we must set it BEFORE requiring the module.
process.env.JWT_SECRET = 'test-secret-for-jest-only-1234567890';

const jwt = require('jsonwebtoken');
const {
  issueAccessToken,
  verifyToken,
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
} = require('../utils/tokens');

/**
 * Tests for utils/tokens.js — access/refresh token issuance, verification,
 * and hashing. Covers the security guarantees: tokens carry only id/name/role,
 * verification rejects tampered/foreign tokens, refresh tokens are high-entropy,
 * and stored hashes are deterministic SHA-256.
 */
describe('access tokens', () => {
  const user = { id: 1, name: 'John Doe', role: 'worker' };

  test('issueAccessToken returns a verifiable JWT', () => {
    const token = issueAccessToken(user);
    expect(typeof token).toBe('string');
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(1);
    expect(decoded.role).toBe('worker');
  });

  test('token payload contains only id, name, role (no sensitive data)', () => {
    const token = issueAccessToken(user);
    const decoded = verifyToken(token);
    const keys = Object.keys(decoded).filter((k) => !['iat', 'exp'].includes(k));
    expect(keys.sort()).toEqual(['id', 'name', 'role']);
  });

  test('verifyToken throws on a tampered token', () => {
    const token = issueAccessToken(user);
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => verifyToken(tampered)).toThrow();
  });

  test('verifyToken throws on a token signed with a different secret', () => {
    const foreign = jwt.sign({ id: 99 }, 'a-different-secret');
    expect(() => verifyToken(foreign)).toThrow();
  });

  test('verifyToken throws on an expired token', () => {
    const expired = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    expect(() => verifyToken(expired)).toThrow();
  });
});

describe('refresh tokens', () => {
  test('generateRefreshToken returns 64 hex chars (256 bits)', () => {
    const rt = generateRefreshToken();
    expect(rt).toMatch(/^[0-9a-f]{64}$/);
  });

  test('two refresh tokens are different (random)', () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  test('refreshExpiryDate is in the future', () => {
    expect(refreshExpiryDate().getTime()).toBeGreaterThan(Date.now());
  });
});

describe('hashToken', () => {
  test('produces a 64-char SHA-256 hex digest', () => {
    expect(hashToken('some-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic (same input -> same hash)', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  test('different inputs produce different hashes', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
