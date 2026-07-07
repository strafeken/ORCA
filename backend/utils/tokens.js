const crypto = require('node:crypto');
const { JwtTokenSigner } = require('../adapters/TokenSigner');

/**
 * Token utilities — access tokens, refresh tokens, and hashing for storage.
 *
 * Design:
 *   - ACCESS token: short-lived JWT (15 min). Sent on every API/socket request
 *     in the Authorization header. Short lifetime limits the damage window if
 *     one is stolen — it expires on its own quickly.
 *   - REFRESH token: long-lived random string (not a JWT), 2 hours. Used once
 *     to mint a new access token, then rotated. Stored ONLY as a hash in the
 *     sessions table, so a database leak does not hand an attacker usable
 *     tokens (same reason we hash passwords). This value is also the
 *     absolute cap on a session's total lifetime (sessions.expires_at) — a
 *     session is force-ended after 2 hours regardless of activity. A
 *     separate, shorter 15-minute INACTIVITY timeout (see
 *     middleware/authMiddleware.js) ends a session sooner than that if the
 *     user stops making requests, the same way most banking/admin tools do.
 *
 * JWT_SECRET must come from the environment. We deliberately do NOT fall back
 * to a hardcoded default — a predictable signing secret means anyone can forge
 * a valid admin token. The app should refuse to start without it.
 */
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — absolute session cap

// JWT signing/verifying is delegated to the TokenSigner adapter (see
// adapters/TokenSigner.js). Constructed at load so the "refuse to start without
// JWT_SECRET" policy still fires here at module load time.
const signer = new JwtTokenSigner(process.env.JWT_SECRET, ACCESS_TOKEN_TTL);

/**
 * Issue a signed access token. The payload is intentionally minimal — only what
 * the app needs to identify the user and authorize requests. Never put secrets
 * or sensitive personal data in a JWT: the payload is only base64-encoded, not
 * encrypted, so anyone holding the token can read it.
 */
function issueAccessToken(user) {
  return signer.sign({ id: user.id, name: user.name, role: user.role });
}

/**
 * Verify an access token. Kept with this exact name and return shape because
 * the existing auth middleware and socket auth import `verifyToken`.
 * Throws on invalid/expired tokens (callers already catch this).
 */
function verifyToken(token) {
  return signer.verify(token);
}

/**
 * Generate a refresh token: a 256-bit cryptographically-random string. This is
 * opaque (not a JWT) — its only job is to be unguessable and to be looked up by
 * its hash in the sessions table.
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a token (refresh or access) for storage with SHA-256. We store hashes,
 * never the raw token, so the sessions table is useless to an attacker who
 * reads it. SHA-256 (not Argon2) is correct here because these tokens are
 * already high-entropy random values — they don't need slow hashing the way
 * human-chosen passwords do.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshExpiryDate() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}

module.exports = {
  issueAccessToken,
  verifyToken,
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
};