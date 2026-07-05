const { Argon2PasswordHasher } = require('../adapters/PasswordHasher');
const { JwtTokenSigner } = require('../adapters/TokenSigner');
const { TokenFactory } = require('../domain/TokenFactory');

/**
 * Tests for the Ports & Adapters layer that encapsulates security primitives:
 *   - Argon2PasswordHasher (SR-17: Argon2id hashing)
 *   - JwtTokenSigner       (SR-18: short-lived JWTs, secret-required policy)
 *   - TokenFactory         (SR-02/SR-21: single-use, time-limited tokens stored
 *                            only as SHA-256 hashes)
 */
describe('Argon2PasswordHasher (SR-17)', () => {
  const hasher = new Argon2PasswordHasher();

  test('hash produces an argon2id string', async () => {
    const h = await hasher.hash('WorkerPass123!');
    expect(h.startsWith('$argon2id$')).toBe(true);
  });

  test('verify returns true for the correct password', async () => {
    const h = await hasher.hash('WorkerPass123!');
    expect(await hasher.verify(h, 'WorkerPass123!')).toBe(true);
  });

  test('verify returns false for a wrong password', async () => {
    const h = await hasher.hash('WorkerPass123!');
    expect(await hasher.verify(h, 'nope')).toBe(false);
  });

  test('verify fails closed on a malformed hash (no throw)', async () => {
    await expect(hasher.verify('garbage', 'x')).resolves.toBe(false);
  });
});

describe('JwtTokenSigner (SR-18)', () => {
  const SECRET = 'unit-test-secret-abcdefghijklmnop';

  test('constructor throws when no secret is provided (no insecure default)', () => {
    expect(() => new JwtTokenSigner('')).toThrow(/JWT_SECRET/);
  });

  test('sign then verify round-trips the payload', () => {
    const signer = new JwtTokenSigner(SECRET);
    const token = signer.sign({ id: 1, role: 'worker' });
    const decoded = signer.verify(token);
    expect(decoded.id).toBe(1);
    expect(decoded.role).toBe('worker');
  });

  test('verify throws on a token signed with a different secret', () => {
    const signer = new JwtTokenSigner(SECRET);
    const other = new JwtTokenSigner('a-totally-different-secret-value');
    const foreign = other.sign({ id: 9 });
    expect(() => signer.verify(foreign)).toThrow();
  });

  test('honours a custom expiry override', () => {
    const signer = new JwtTokenSigner(SECRET);
    const token = signer.sign({ id: 1 }, { expiresIn: '-1s' }); // already expired
    expect(() => signer.verify(token)).toThrow();
  });
});

describe('TokenFactory (SR-02 / SR-21)', () => {
  const factory = new TokenFactory();

  test('create returns raw, hash, table, and future expiry', () => {
    const t = factory.create('verification');
    expect(t.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.raw).not.toBe(t.hash); // only the hash is persisted
    expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('reset tokens expire sooner than verification tokens (higher risk)', () => {
    const reset = factory.create('reset');
    const verify = factory.create('verification');
    expect(reset.expiresAt.getTime()).toBeLessThan(verify.expiresAt.getTime());
  });

  test('routes each kind to the correct table', () => {
    expect(factory.tableFor('reset')).toBe('password_reset_tokens');
    expect(factory.tableFor('verification')).toBe('email_verification_tokens');
  });

  test('unknown kinds fall back to verification config', () => {
    expect(factory.tableFor('anything-else')).toBe('email_verification_tokens');
  });

  test('hash is deterministic SHA-256', () => {
    expect(factory.hash('abc')).toBe(factory.hash('abc'));
    expect(factory.hash('abc')).not.toBe(factory.hash('abd'));
  });
});
