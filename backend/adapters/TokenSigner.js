const jwt = require('jsonwebtoken');

/**
 * TokenSigner — Ports & Adapters over jsonwebtoken.
 *
 * The rest of the app depends on "sign / verify a token" rather than on the JWT
 * library or the raw signing secret. Also the single place that enforces the
 * secret-required policy: a predictable signing secret would let anyone forge a
 * valid admin token, so construction throws if the secret is missing.
 */
class JwtTokenSigner {
  constructor(secret = process.env.JWT_SECRET, accessTtl = '15m') {
    if (!secret) {
      throw new Error('JWT_SECRET is not set. Refusing to start with an insecure default.');
    }
    this.secret = secret;
    this.accessTtl = accessTtl;
  }

  /** Sign a short-lived access token; extra options can override the default TTL. */
  sign(payload, options = {}) {
    return jwt.sign(payload, this.secret, { expiresIn: this.accessTtl, ...options });
  }

  /** Verify a token; throws on invalid/expired (callers already catch this). */
  verify(token) {
    return jwt.verify(token, this.secret);
  }
}

module.exports = { JwtTokenSigner };
