const crypto = require('node:crypto');

/**
 * messageCipher — application-layer encryption of chat message content at rest
 * (SR-06: "encrypt all PII fields at rest; encryption keys stored separately
 * from the encrypted data").
 *
 * Why application-layer and not MySQL/RDS storage encryption: storage-level
 * encryption only protects the disk — the database still returns plaintext to
 * any authenticated query (e.g. `root` running `SELECT * FROM messages`). Only
 * encrypting in the app keeps the content opaque to a DB-level read. The key
 * lives in MESSAGE_ENC_KEY (environment / secrets store), never in the database
 * or source, satisfying the "keys stored separately" requirement.
 *
 * This does NOT change who can READ a message — that is still enforced by the
 * server's authorization (participant check for users, RBAC for admins). Because
 * an admin must be able to read every conversation, the server necessarily holds
 * the key and decrypts for whoever authorization already allowed through. This
 * is confidentiality against database/backup compromise, not access control.
 *
 * Algorithm: AES-256-GCM (confidentiality + integrity), a fresh random 96-bit
 * IV per message, mirroring utils/totp.js. Stored format:
 *
 *     v1:<iv-hex>:<tag-hex>:<ciphertext-hex>
 *
 * The "v1" scheme tag lets us rotate keys/algorithms later without ambiguity.
 *
 * Rollout safety: decrypt() passes through any value that is NOT in the v1
 * format (legacy plaintext rows and the seed data), so a half-migrated database
 * reads correctly until scripts/encryptMessages.js backfills the old rows.
 *
 * .env: MESSAGE_ENC_KEY = 64 hex chars (32 bytes).
 *   generate: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
 */

const SCHEME = 'v1';
const KEY_HEX = process.env.MESSAGE_ENC_KEY;

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('MESSAGE_ENC_KEY must be set to 64 hex chars (32 bytes).');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

/**
 * True only for values in our exact v1 envelope: the scheme prefix plus three
 * hex segments. The strict shape check means a legacy plaintext message that
 * happened to start with "v1:" is not mistaken for ciphertext.
 */
function isEncrypted(value) {
  if (typeof value !== 'string' || !value.startsWith(`${SCHEME}:`)) return false;
  const parts = value.split(':');
  return (
    parts.length === 4 &&
    /^[0-9a-f]+$/i.test(parts[1]) &&
    /^[0-9a-f]+$/i.test(parts[2]) &&
    /^[0-9a-f]+$/i.test(parts[3])
  );
}

/** Encrypt plaintext for storage. null/undefined pass through unchanged. */
function encrypt(plaintext) {
  if (plaintext == null) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SCHEME}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a stored value. Anything that is not a v1 envelope (null, or legacy
 * plaintext / seed rows) is returned as-is, so reads never break mid-migration.
 * A v1 envelope that fails GCM verification throws — tampering/corruption is a
 * real error, not something to silently mask.
 */
function decrypt(stored) {
  if (!isEncrypted(stored)) return stored;
  const [, ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
