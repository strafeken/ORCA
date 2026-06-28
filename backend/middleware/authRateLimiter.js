const rateLimit = require('express-rate-limit');

/**
 * Rate limiters specific to authentication endpoints.
 *
 * The global limiter (100 req / 15 min) is too loose for login: it would allow
 * hundreds of password guesses. These tighter limits are a second layer on top
 * of the per-account lockout in authService — lockout protects one account,
 * rate limiting protects the endpoint from broad/distributed guessing and from
 * someone cycling through many usernames.
 *
 * keyGenerator defaults to client IP. Because app.js sets `trust proxy`, the
 * real client IP (forwarded by nginx) is used rather than nginx's own IP.
 */

// Login / register: modest allowance for legitimate retries and typos.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

// Admin login: deliberately stricter. The admin endpoint is unlinked and only
// admins should ever hit it, so a low ceiling here is both safe for real admins
// and hostile to anyone who discovers the path and tries to brute force it.
const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

module.exports = { authLimiter, adminAuthLimiter };
