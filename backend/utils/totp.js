const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const pool = require('../db/pool').promise();

/**
 * TOTP (Time-based One-Time Password) — optional second factor, e.g. Google
 * Authenticator / Authy.
 *
 * Flow:
 *   1. setup: generate a secret, store it ENCRYPTED, return a QR code for the
 *      user to scan. (Not yet enabled — user must prove they can generate a
 *      code before we trust it.)
 *   2. enable: user submits a 6-digit code from their app; if it verifies, TOTP
 *      is active for that account.
 *   3. at login: if the user has TOTP enabled, require a valid code.
 *
 * Secret storage: the TOTP secret is as sensitive as a password — anyone with
 * it can generate valid codes forever. So we store it ENCRYPTED (AES-256-GCM)
 * rather than in plaintext. The encryption key comes from TOTP_ENC_KEY in .env
 * (32 bytes hex). We can't hash it (unlike passwords) because we need to read
 * it back to verify codes — so encryption, not hashing, is the right tool.
 *
 * .env: TOTP_ENC_KEY = 64 hex chars (32 bytes).
 *   generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const ENC_KEY_HEX = process.env.TOTP_ENC_KEY;

function getKey() {
  if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
    throw new Error('TOTP_ENC_KEY must be set to 64 hex chars (32 bytes).');
  }
  return Buffer.from(ENC_KEY_HEX, 'hex');
}

// AES-256-GCM: gives confidentiality + integrity. We store iv:tag:ciphertext.
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(stored) {
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/**
 * Generate a new TOTP secret for a user and store it encrypted. Returns a
 * data-URL QR code the frontend can render for scanning. Overwrites any
 * existing (not-yet-enabled) secret.
 */
async function setupTotp(user) {
  const secret = speakeasy.generateSecret({
    name: `ORCA (${user.email || user.name})`,
    length: 20,
  });

  const encrypted = encrypt(secret.base32);

  // Upsert into totp_secrets (UNIQUE on user_id).
  await pool.query(
    `INSERT INTO totp_secrets (user_id, secret_encrypted)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE secret_encrypted = VALUES(secret_encrypted)`,
    [user.id, encrypted]
  );

  const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
  return { qrDataUrl };
}

/**
 * Verify a 6-digit code against the user's stored secret. `window: 1` allows
 * for slight clock drift (accepts the adjacent 30s step). Returns true/false.
 */
async function verifyTotp(userId, code) {
  const [rows] = await pool.query(
    'SELECT secret_encrypted FROM totp_secrets WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const row = rows[0];
  if (!row) return false;

  let secret;
  try {
    secret = decrypt(row.secret_encrypted);
  } catch {
    return false;
  }

  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(code || '').trim(),
    window: 1,
  });
}

/**
 * Whether the user has a TOTP secret on file (i.e. 2FA is set up).
 */
async function hasTotp(userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM totp_secrets WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return rows.length > 0;
}

async function disableTotp(userId) {
  await pool.query('DELETE FROM totp_secrets WHERE user_id = ?', [userId]);
}

module.exports = { setupTotp, verifyTotp, hasTotp, disableTotp };
