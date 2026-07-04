const { Argon2PasswordHasher, DEFAULT_HASH_OPTIONS } = require('../adapters/PasswordHasher');

/**
 * Password utilities. Hashing is delegated to the Argon2PasswordHasher adapter
 * (see adapters/PasswordHasher.js); this module keeps the stable function API
 * the rest of the app already imports, plus the server-side password policy.
 *
 * HASH_OPTIONS is re-exported unchanged so it still matches the seed file's
 * hash format ($argon2id$v=19$m=65536,t=3,p=4$...).
 */
const HASH_OPTIONS = DEFAULT_HASH_OPTIONS;
const hasher = new Argon2PasswordHasher(HASH_OPTIONS);

async function hashPassword(plain) {
  return hasher.hash(plain);
}

async function verifyPassword(hash, plain) {
  return hasher.verify(hash, plain);
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
