const argon2 = require('argon2');

/**
 * PasswordHasher — Ports & Adapters.
 *
 * Encapsulates the password-hashing dependency (argon2) behind a class so the
 * rest of the app depends on the *capability* ("hash / verify a password"),
 * not on the argon2 library directly. This is what makes services that hash
 * passwords unit-testable: inject a fake hasher instead of running real Argon2.
 *
 * Argon2id parameters follow OWASP minimum guidance and match the seed file's
 * hash format ($argon2id$v=19$m=65536,t=3,p=4$...), so seeded and runtime
 * hashes are produced identically.
 */
const DEFAULT_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

class Argon2PasswordHasher {
  constructor(options = DEFAULT_HASH_OPTIONS) {
    this.options = options;
  }

  async hash(plain) {
    return argon2.hash(plain, this.options);
  }

  /**
   * Constant-time verify (argon2 does the comparison internally). Swallows
   * malformed-hash errors and returns false, so a bad stored value can never be
   * mistaken for a match.
   */
  async verify(hash, plain) {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}

module.exports = { Argon2PasswordHasher, DEFAULT_HASH_OPTIONS };
