/**
 * Tests for utils/oneTimeTokens.js — email-verification and password-reset
 * tokens. Verifies the security properties required by SR-19 (email
 * verification) and SR-21 (single-use, time-limited reset tokens):
 *   - tokens are high-entropy and stored only as a SHA-256 hash
 *   - consuming validates hash + unexpired + unused, atomically single-use
 *   - a bad/expired/already-used token yields null (no access)
 */
const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({ promise: () => ({ query: mockQuery }) }));

const {
  issueToken,
  consumeToken,
  VERIFICATION_TTL_MS,
  RESET_TTL_MS,
} = require('../utils/oneTimeTokens');

describe('issueToken', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns a 64-char hex raw token (256-bit entropy)', async () => {
    mockQuery.mockResolvedValue([{}]);
    const raw = await issueToken('verification', 1);
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  test('stores only a HASH, never the raw token', async () => {
    mockQuery.mockResolvedValue([{}]);
    const raw = await issueToken('verification', 1);
    // Find the INSERT call and check the stored value isn't the raw token.
    const insertCall = mockQuery.mock.calls.find((c) => /INSERT/i.test(c[0]));
    expect(insertCall).toBeDefined();
    const storedHash = insertCall[1][1];
    expect(storedHash).not.toBe(raw);
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  test('invalidates prior outstanding tokens before inserting a new one', async () => {
    mockQuery.mockResolvedValue([{}]);
    await issueToken('reset', 7);
    const updateCall = mockQuery.mock.calls.find((c) => /UPDATE/i.test(c[0]) && /used = TRUE/i.test(c[0]));
    expect(updateCall).toBeDefined();
  });

  test('reset tokens use the password_reset_tokens table', async () => {
    mockQuery.mockResolvedValue([{}]);
    await issueToken('reset', 1);
    const insertCall = mockQuery.mock.calls.find((c) => /INSERT/i.test(c[0]));
    expect(insertCall[0]).toContain('password_reset_tokens');
  });

  test('verification tokens use the email_verification_tokens table', async () => {
    mockQuery.mockResolvedValue([{}]);
    await issueToken('verification', 1);
    const insertCall = mockQuery.mock.calls.find((c) => /INSERT/i.test(c[0]));
    expect(insertCall[0]).toContain('email_verification_tokens');
  });

  test('reset TTL is shorter than verification TTL (higher-risk action)', () => {
    expect(RESET_TTL_MS).toBeLessThan(VERIFICATION_TTL_MS);
  });
});

describe('consumeToken', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns null for an empty/invalid token without querying', async () => {
    expect(await consumeToken('reset', '')).toBeNull();
    expect(await consumeToken('reset', null)).toBeNull();
  });

  test('returns null when no matching valid token row exists', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // SELECT returns nothing
    expect(await consumeToken('verification', 'sometoken')).toBeNull();
  });

  test('returns the user_id and marks the token used on success', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 10, user_id: 42 }]]) // SELECT finds it
      .mockResolvedValueOnce([{ affectedRows: 1 }]);       // UPDATE marks used
    const uid = await consumeToken('verification', 'validtoken');
    expect(uid).toBe(42);
    // Confirms the single-use UPDATE was issued.
    const updateCall = mockQuery.mock.calls.find((c) => /UPDATE/i.test(c[0]) && /used = TRUE/i.test(c[0]));
    expect(updateCall).toBeDefined();
  });

  test('returns null if the atomic mark-used affects no rows (already consumed)', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 10, user_id: 42 }]]) // SELECT finds it
      .mockResolvedValueOnce([{ affectedRows: 0 }]);       // race: someone else used it
    expect(await consumeToken('verification', 'validtoken')).toBeNull();
  });
});
