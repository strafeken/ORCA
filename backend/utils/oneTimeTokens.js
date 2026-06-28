const crypto = require('crypto');
const pool = require('../db/pool').promise();

/**
 * One-time token helper — shared by email verification and password reset.
 *
 * Both flows follow the same secure pattern:
 *   1. Generate a high-entropy random token (256 bits) — the RAW token goes in
 *      the link sent to the user, and nowhere else.
 *   2. Store only the SHA-256 HASH of the token in the database, with an
 *      expiry and a single-use flag. A database leak therefore yields no usable
 *      tokens (same reasoning as hashing passwords / session tokens).
 *   3. To consume: hash the incoming token, look it up, check it's unexpired
 *      and unused, then mark it used.
 *
 * SHA-256 (not Argon2) is correct here because the token is already random and
 * high-entropy — it doesn't need slow hashing the way human passwords do.
 */

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS = 60 * 60 * 1000;             // 1 hour (shorter — higher risk)

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a token of the given kind and persist its hash.
 * @param {'verification'|'reset'} kind
 * @returns the RAW token (to embed in the email link)
 */
async function issueToken(kind, userId) {
  const raw = generateToken();
  const tokenHash = hashToken(raw);
  const ttl = kind === 'reset' ? RESET_TTL_MS : VERIFICATION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  const table = kind === 'reset' ? 'password_reset_tokens' : 'email_verification_tokens';

  // Invalidate any prior outstanding tokens of this kind for the user, so only
  // the newest link works (prevents a pile of valid links accumulating).
  await pool.query(`UPDATE ${table} SET used = TRUE WHERE user_id = ? AND used = FALSE`, [userId]);

  await pool.query(
    `INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );

  return raw;
}

/**
 * Consume a token: validate and mark used in one shot. Returns the user_id on
 * success, or null if the token is invalid/expired/already used.
 *
 * The UPDATE ... WHERE (used = FALSE AND expires_at > NOW()) is atomic — it
 * both checks validity and marks the token used in a single statement, so the
 * same token can't be redeemed twice via a race.
 */
async function consumeToken(kind, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const table = kind === 'reset' ? 'password_reset_tokens' : 'email_verification_tokens';
  const tokenHash = hashToken(rawToken);

  const [rows] = await pool.query(
    `SELECT id, user_id FROM ${table}
      WHERE token_hash = ? AND used = FALSE AND expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;

  const [result] = await pool.query(
    `UPDATE ${table} SET used = TRUE WHERE id = ? AND used = FALSE`,
    [row.id]
  );
  // If no row was updated, another request consumed it first — treat as invalid.
  if (result.affectedRows !== 1) return null;

  return row.user_id;
}

module.exports = { issueToken, consumeToken, VERIFICATION_TTL_MS, RESET_TTL_MS };
