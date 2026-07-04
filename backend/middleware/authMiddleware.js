const { verifyToken, hashToken } = require('../utils/tokens');
const { system } = require('../utils/winstonLogger');
const { SessionRepository } = require('../repositories/SessionRepository');

// Session-table access is delegated to SessionRepository; this middleware keeps
// the JWT check and the idle-timeout / touch policy.
const sessionRepo = new SessionRepository();

/**
 * authMiddleware — verifies the access token on protected API routes.
 *
 * Three checks happen here, in order:
 *   1. Verify the JWT signature and expiry (fast, no DB hit).
 *   2. Look up the token hash in the sessions table and confirm the session
 *      has not been revoked (revoked = TRUE) by an admin, a logout, an
 *      account deletion, or an expert-approval revocation.
 *   3. Idle (inactivity) timeout: if more than INACTIVITY_TIMEOUT_MS has
 *      passed since this session's last touched request, the session is
 *      expired and revoked even though neither the JWT nor the absolute
 *      session expiry (sessions.expires_at, currently 2 hours — see
 *      utils/tokens.js) have been reached yet.
 *
 * "Activity" is defined as making an authenticated API request — the same
 * definition almost every web app uses for idle timeouts, since real mouse
 * or keyboard activity never reaches the server on its own. Each request
 * that passes the checks above "touches" the session by bumping
 * last_activity to now, sliding the 15-minute window forward. The one
 * deliberate exception is the lightweight GET /api/auth/session heartbeat
 * the frontend polls in the background to detect server-side revocations —
 * that check must NOT itself count as activity, or a totally idle tab would
 * keep extending its own session forever just by sitting open. It uses
 * authMiddlewareNoTouch below instead.
 *
 * Performance: the sessions table is indexed on token_hash (see
 * migration_session_token_index.sql). The extra query/update is one indexed
 * lookup (+ a write, for touching routes) per request — acceptable for the
 * security gain, and much cheaper than re-hashing a password.
 */

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * @param {{ touch?: boolean }} [options] - set touch:false to validate the
 *   session without resetting its inactivity clock (used by the session
 *   heartbeat endpoint only).
 */
function makeAuthMiddleware({ touch = true } = {}) {
  return async function authMiddlewareImpl(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Step 1 — verify JWT signature and expiry. Fast path: no DB hit needed if
    // the token is already malformed or expired.
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Step 2 & 3 — check the session row is still live (not revoked) and has
    // not gone idle past the inactivity timeout.
    try {
      const session = await sessionRepo.findByTokenHash(hashToken(token));

      if (!session) {
        // Session was revoked (by admin termination, logout, expert-approval
        // revocation, or account deletion).
        return res.status(401).json({ error: 'Session has been revoked.' });
      }

      const idleMs = Date.now() - new Date(session.last_activity).getTime();

      if (idleMs > INACTIVITY_TIMEOUT_MS) {
        // Idle too long — expire it. Marking it revoked (rather than just
        // rejecting this one request) means it disappears from the admin
        // "active sessions" list immediately and can't be reused even if a
        // stray background request slips in after this check.
        await sessionRepo.revokeById(session.id);
        return res.status(401).json({ error: 'Session expired due to inactivity.' });
      }

      if (touch) {
        // Sliding window: this was a real user-initiated request, so reset
        // the idle clock. Fire-and-forget would risk losing the update under
        // load; awaiting keeps it simple and correct at this scale.
        await sessionRepo.touch(session.id);
      }
    } catch (err) {
      system.error('Session revocation/inactivity check failed', {
        context: 'authMiddleware',
        error: err.message,
      });
      // Fail closed: if the DB check errors, reject the request rather than
      // allowing potentially-revoked or idle-expired sessions through.
      return res.status(500).json({ error: 'Authentication check failed.' });
    }

    req.user = decoded;
    next();
  };
}

// Default export used by virtually every protected route — validates AND
// resets the inactivity clock.
const authMiddleware = makeAuthMiddleware({ touch: true });

// Used ONLY by the GET /api/auth/session heartbeat — validates without
// resetting the inactivity clock, so polling alone can't keep an otherwise
// idle session alive.
const authMiddlewareNoTouch = makeAuthMiddleware({ touch: false });

/**
 * requireRole — gate a route to specific roles. Use AFTER authMiddleware.
 *
 * This is the SERVER-SIDE enforcement of role-based access control. The
 * frontend route guards are UX only; this is the real boundary.
 *
 *     router.use(authMiddleware, requireRole('admin'));
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authMiddleware, authMiddlewareNoTouch, requireRole, INACTIVITY_TIMEOUT_MS };