const { hashPassword, verifyPassword, HASH_OPTIONS } = require('../utils/password');

/**
 * Tests for utils/password.js — Argon2id hashing and verification.
 * These cover the security-critical guarantees: correct passwords verify,
 * wrong ones don't, hashes are salted (non-deterministic), and malformed
 * hashes fail closed rather than throwing.
 */
describe('password hashing (Argon2id)', () => {
  test('hashPassword produces an argon2id hash string', async () => {
    const hash = await hashPassword('WorkerPass123!');
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  test('uses the OWASP parameters (m=65536, t=3, p=4)', async () => {
    const hash = await hashPassword('WorkerPass123!');
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=4');
  });

  test('HASH_OPTIONS are the expected cost parameters', () => {
    expect(HASH_OPTIONS.memoryCost).toBe(65536);
    expect(HASH_OPTIONS.timeCost).toBe(3);
    expect(HASH_OPTIONS.parallelism).toBe(4);
  });

  test('the same password hashes to different values (random salt)', async () => {
    const a = await hashPassword('SamePassword123!');
    const b = await hashPassword('SamePassword123!');
    expect(a).not.toBe(b); // salts differ, so hashes differ
  });

  test('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('CorrectHorse123!');
    expect(await verifyPassword(hash, 'CorrectHorse123!')).toBe(true);
  });

  test('verifyPassword returns false for a wrong password', async () => {
    const hash = await hashPassword('CorrectHorse123!');
    expect(await verifyPassword(hash, 'wrongpassword')).toBe(false);
  });

  test('verifyPassword is case-sensitive', async () => {
    const hash = await hashPassword('CaseSensitive1!');
    expect(await verifyPassword(hash, 'casesensitive1!')).toBe(false);
  });

  test('verifyPassword returns false (does not throw) on a malformed hash', async () => {
    // A bad stored value must never be mistaken for a match.
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false);
  });

  test('verifyPassword returns false on an empty hash', async () => {
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });
});

describe('passwordPolicyError', () => {
  const { passwordPolicyError, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } = require('../utils/password');

  test('returns null for a password within bounds', () => {
    expect(passwordPolicyError('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(passwordPolicyError('a'.repeat(MAX_PASSWORD_LENGTH))).toBeNull();
  });

  test('rejects non-string and short passwords', () => {
    expect(passwordPolicyError(undefined)).toMatch(/8 characters/i);
    expect(passwordPolicyError('short')).toMatch(/8 characters/i);
  });

  test('rejects passwords over the maximum length', () => {
    expect(passwordPolicyError('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/too long/i);
  });
});
