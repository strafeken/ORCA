const pool = require('../db/pool').promise();
const { TokenFactory, TOKEN_KINDS } = require('../domain/TokenFactory');

/**
 * One-time token helper — shared by email verification and password reset.
 *
 * Token material (raw value, hash, table, expiry) is produced by TokenFactory
 * (domain/TokenFactory.js); this module owns only the persistence + validation:
 *   1. issue:   ask the factory for a token, invalidate prior ones, store hash.
 *   2. consume: hash the incoming token, look it up unexpired/unused, mark used.
 *
 * Only the SHA-256 HASH is ever stored, so a DB leak yields no usable tokens.
 */

const VERIFICATION_TTL_MS = TOKEN_KINDS.verification.ttlMs;
const RESET_TTL_MS = TOKEN_KINDS.reset.ttlMs;

const tokenFactory = new TokenFactory();

/**
 * Issue a token of the given kind and persist its hash.
 * @param {'verification'|'reset'} kind
 * @returns the RAW token (to embed in the email link)
 */
async function issueToken(kind, userId) {
  const { raw, hash, table, expiresAt } = tokenFactory.create(kind);

  // Invalidate any prior outstanding tokens of this kind for the user, so only
  // the newest link works.
  await pool.query(`UPDATE ${table} SET used = TRUE WHERE user_id = ? AND used = FALSE`, [userId]);

  await pool.query(
    `INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, hash, expiresAt]
  );

  return raw;
}

/**
 * Look up a token's owning user WITHOUT consuming it. Returns the user_id if the
 * token is valid/unexpired/unused, else null.
 */
async function peekToken(kind, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const table = tokenFactory.tableFor(kind);
  const tokenHash = tokenFactory.hash(rawToken);

  const [rows] = await pool.query(
    `SELECT user_id FROM ${table}
      WHERE token_hash = ? AND used = FALSE AND expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Consume a token: validate and mark used atomically. Returns the user_id on
 * success, or null if invalid/expired/already used.
 */
async function consumeToken(kind, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const table = tokenFactory.tableFor(kind);
  const tokenHash = tokenFactory.hash(rawToken);

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
  if (result.affectedRows !== 1) return null;

  return row.user_id;
}

module.exports = { issueToken, consumeToken, peekToken, VERIFICATION_TTL_MS, RESET_TTL_MS };
