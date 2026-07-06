const crypto = require('crypto');

/**
 * HIBP Pwned Passwords k-anonymity digest. The public range API requires SHA-1
 * so only the first 5 hex chars leave the server; the full password is never
 * transmitted. This is not a stored password hash — Argon2id handles that.
 *
 * @param {string} plaintext
 * @returns {{ prefix: string, suffix: string }}
 */
function hibpRangeDigest(plaintext) {
  // codeql[js/insufficient-password-hash]: SHA-1 is mandated by the HIBP range API k-anonymity model; not used for credential storage.
  const digest = crypto.createHash('sha1').update(plaintext).digest('hex').toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

/** Constant-time compare for equal-length HIBP hash suffixes. */
function hibpSuffixMatches(lineSuffix, targetSuffix) {
  if (lineSuffix.length !== targetSuffix.length) return false;
  return crypto.timingSafeEqual(Buffer.from(lineSuffix), Buffer.from(targetSuffix));
}

module.exports = { hibpRangeDigest, hibpSuffixMatches };
