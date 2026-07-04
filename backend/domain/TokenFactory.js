const crypto = require('crypto');

/**
 * TokenFactory — Factory for one-time tokens (email verification, password
 * reset). Encapsulates the per-kind configuration (which table, how long it
 * lives) and the token material creation (a 256-bit random value stored only as
 * its SHA-256 hash), so callers just ask for "a token of kind X".
 *
 * SHA-256 (not Argon2) is correct here: the token is already high-entropy, so
 * it doesn't need slow hashing the way human passwords do.
 */
const TOKEN_KINDS = {
  verification: { table: 'email_verification_tokens', ttlMs: 24 * 60 * 60 * 1000 }, // 24h
  reset: { table: 'password_reset_tokens', ttlMs: 60 * 60 * 1000 }, // 1h (higher risk)
};

class TokenFactory {
  #configFor(kind) {
    // Any non-'reset' kind falls back to verification, matching the original.
    return TOKEN_KINDS[kind] || TOKEN_KINDS.verification;
  }

  /**
   * Create the material for a new token of the given kind:
   * { raw, hash, table, expiresAt }. `raw` goes in the emailed link and nowhere
   * else; only `hash` is persisted.
   */
  create(kind) {
    const { table, ttlMs } = this.#configFor(kind);
    const raw = crypto.randomBytes(32).toString('hex');
    return {
      raw,
      hash: this.hash(raw),
      table,
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  /** Hash an incoming raw token for lookup (consume/peek). */
  hash(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  tableFor(kind) {
    return this.#configFor(kind).table;
  }
}

module.exports = { TokenFactory, TOKEN_KINDS };
