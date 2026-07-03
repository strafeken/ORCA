const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { verifyToken } = require('../utils/tokens');

/**
 * globalLimiter — the catch-all rate limit applied to every API request
 * (app.js mounts this before any route).
 *
 * BUG FIXED: this limiter previously had no keyGenerator, so express-rate-
 * limit defaulted to bucketing purely by req.ip. Two browser tabs on the
 * SAME machine (e.g. an admin session in one tab, a regular user session in
 * another, which is exactly how soft-lock/hard-lock testing is done) share
 * one source IP and therefore shared a single 100-request/15-min bucket
 * between them. Worse, the AuthContext session heartbeat
 * (GET /api/auth/session, every 20s per authenticated tab) was also being
 * counted against that same shared budget — two idle tabs alone burn ~90 of
 * the 100 requests in 15 minutes before a single deliberate click happens.
 *
 * FIX, two parts:
 *
 *   1. keyGenerator: if the request carries a valid Authorization bearer
 *      token, key the bucket on the verified user ID instead of the IP.
 *      This is a *security improvement* on top of the bug fix — IP-only
 *      keying means anyone behind a shared IP (NAT, office network, campus
 *      wifi, this exact admin+user dev setup) can exhaust each other's
 *      quota, intentionally or not. Keying on user ID gives every
 *      authenticated principal their own independent budget. The token is
 *      verified (not just decoded) here so a forged/garbage token can't be
 *      used to claim an arbitrary bucket — verification failure falls back
 *      to the IP key, same as an anonymous request.
 *
 *      Unauthenticated requests (no token, or an invalid one) still fall
 *      back to IP-based keying, since there's no user identity to key on
 *      and we still need *some* throttle on anonymous traffic.
 *
 *   2. skip: the session heartbeat (GET /api/auth/session) is exempted from
 *      this counter entirely. It already runs through authMiddleware's own
 *      revocation/idle check on every call, which is the actual security
 *      control we care about for that endpoint — counting it against the
 *      general action budget just crowds out real user actions for no
 *      security benefit. (Login/auth endpoints still have their own
 *      dedicated, stricter limiter — see authRateLimiter.js / SR-13, SR-17 —
 *      this skip does not touch that.)
 */

function keyGenerator(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // Verified, not just decoded — a tampered/forged token must not be
      // able to pick an arbitrary bucket to write into.
      const decoded = verifyToken(token);
      if (decoded && decoded.id != null) {
        return `user:${decoded.id}`;
      }
    } catch {
      // Invalid/expired token — fall through to IP-based keying below.
    }
  }
  // Use the library's helper so IPv6 addresses are normalized/subnet-masked
  // instead of keyed per-address, closing an IPv6 bypass vector.
  return ipKeyGenerator(req.ip);
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  // Don't let the background session-heartbeat poll eat into the same
  // budget as deliberate user actions (see fix note above).
  skip: (req) => req.method === 'GET' && req.path === '/api/auth/session',
  message: { error: 'Too many requests, please try again later.' },
});

module.exports = { globalLimiter, keyGenerator };