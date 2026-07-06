// A valid 32-byte (64 hex char) key so encrypt() works during setupTotp.
process.env.TOTP_ENC_KEY = '0'.repeat(64);

// Mock the DB pool: totp.js does `require('../db/pool').promise()`.
const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({
  promise: () => ({ query: mockQuery }),
}));

const { setupTotp, confirmTotp, hasTotp } = require('../utils/totp');

afterEach(() => jest.clearAllMocks());

/**
 * The bug this guards: a TOTP secret used to count as "2FA enabled" the instant
 * /totp/setup stored it, so a user who generated a QR but never scanned/confirmed
 * it was prompted for a code at login and locked out. hasTotp must now only count
 * secrets that were CONFIRMED via /totp/enable (confirmed_at IS NOT NULL).
 */
describe('hasTotp only counts confirmed secrets', () => {
  test('an unconfirmed secret does NOT count as enabled', async () => {
    // Query filters on confirmed_at IS NOT NULL, so an unconfirmed row returns
    // zero matches -> hasTotp false.
    mockQuery.mockResolvedValue([[]]);
    await expect(hasTotp(1)).resolves.toBe(false);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/confirmed_at IS NOT NULL/i);
  });

  test('a confirmed secret counts as enabled', async () => {
    mockQuery.mockResolvedValue([[{ 1: 1 }]]);
    await expect(hasTotp(1)).resolves.toBe(true);
  });
});

describe('setupTotp leaves 2FA unconfirmed', () => {
  test('stores the secret with confirmed_at reset to NULL', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await setupTotp({ id: 7, email: 'a@b.com', name: 'A' });

    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO totp_secrets/i.test(c[0]));
    expect(insert).toBeDefined();
    // Both the initial insert and the re-setup path must null out confirmation.
    expect(insert[0]).toMatch(/confirmed_at/i);
    expect(insert[0]).toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*confirmed_at = NULL/i);
  });
});

describe('confirmTotp activates 2FA', () => {
  test('sets confirmed_at = NOW() for the user', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await confirmTotp(7);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE totp_secrets SET confirmed_at = NOW\(\)/i);
    expect(params).toContain(7);
  });
});

describe('verifyTotp', () => {
  const speakeasy = require('speakeasy');
  const { verifyTotp } = require('../utils/totp');

  test('returns false when no secret is stored', async () => {
    mockQuery.mockResolvedValue([[]]);
    await expect(verifyTotp(1, '123456')).resolves.toBe(false);
  });

  test('returns false when decryption fails', async () => {
    mockQuery.mockResolvedValue([[{ secret_encrypted: 'not-valid-ciphertext' }]]);
    await expect(verifyTotp(1, '123456')).resolves.toBe(false);
  });

  test('returns true for a valid code against a stored secret', async () => {
    const secret = speakeasy.generateSecret({ length: 20 });
    const { encrypt } = (() => {
      const crypto = require('crypto');
      const ENC_KEY_HEX = process.env.TOTP_ENC_KEY;
      const getKey = () => Buffer.from(ENC_KEY_HEX, 'hex');
      return {
        encrypt(plaintext) {
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
          const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
          const tag = cipher.getAuthTag();
          return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
        },
      };
    })();

    const token = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });
    mockQuery.mockResolvedValue([[{ secret_encrypted: encrypt(secret.base32) }]]);
    await expect(verifyTotp(9, token)).resolves.toBe(true);
  });

  test('returns false for an invalid code', async () => {
    const secret = speakeasy.generateSecret({ length: 20 });
    const crypto = require('crypto');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.TOTP_ENC_KEY, 'hex'), iv);
    const enc = Buffer.concat([cipher.update(secret.base32, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const stored = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;

    mockQuery.mockResolvedValue([[{ secret_encrypted: stored }]]);
    await expect(verifyTotp(9, '000000')).resolves.toBe(false);
  });
});

describe('disableTotp', () => {
  const { disableTotp } = require('../utils/totp');

  test('deletes the stored secret for the user', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await disableTotp(3);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM totp_secrets/i);
    expect(params).toEqual([3]);
  });
});
