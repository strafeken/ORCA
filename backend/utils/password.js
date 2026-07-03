const argon2 = require('argon2');

/**
 * Password hashing — Argon2id.
 *
 * Argon2id is the current OWASP-recommended password hashing algorithm. It is
 * memory-hard, which makes large-scale GPU/ASIC cracking expensive, and the
 * "id" variant resists both side-channel and GPU attacks.
 *
 * Parameters below follow OWASP's minimum guidance:
 *   - memoryCost 64 MiB  (m=65536)   raises the cost of each guess
 *   - timeCost   3       (t=3)       iterations
 *   - parallelism 4      (p=4)
 *
 * These match the format string used in the seed file
 * ($argon2id$v=19$m=65536,t=3,p=4$...), so seeded and runtime hashes are
 * produced the same way.
 *
 * The salt is generated and embedded by argon2 automatically — we never store
 * or manage it separately, and never reuse one.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

async function hashPassword(plain) {
  return argon2.hash(plain, HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Returns true/false. argon2.verify does a constant-time comparison internally,
 * so this does not leak timing information about how much of the hash matched.
 * We swallow errors (e.g. a malformed hash) and return false rather than
 * throwing, so a bad stored value can never be mistaken for a match.
 */
async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Basic password policy. Kept deliberately simple and length-forward (length
 * matters far more than character-class rules). Tune to match the team's
 * agreed policy; the important part is that it's enforced server-side, never
 * trusting the client.
 */
function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters.';
  }
  if (password.length > 128) {
    return 'Password is too long.';
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, passwordPolicyError, HASH_OPTIONS };
