const express = require('express');
const router = express.Router();
const pool = require('../db/pool').promise();

const { hashPassword } = require('../utils/password');
const {
  authenticateUser,
  createSession,
  revokeSessionByRefreshToken,
  AuthResult,
} = require('../utils/authService');
const { authLimiter, adminAuthLimiter } = require('../middleware/authRateLimiter');
const { system, audit } = require('../utils/winstonLogger');

/**
 * Auth routes.
 *
 *   POST /api/auth/register     create a worker or expert account
 *   POST /api/auth/login        log in (workers + experts; rejects admins)
 *   POST /api/auth/admin/login  log in (admins only; stricter limit + audit)
 *   POST /api/auth/logout       revoke the current session
 *   POST /api/auth/refresh      exchange a refresh token for a new access token
 *
 * Cross-cutting rules applied throughout:
 *   - Generic failure messages (no account enumeration).
 *   - Input validated/normalised before use.
 *   - All queries are parameterised (no string-built SQL) -> no SQL injection.
 *   - Auth events are logged for the audit trail.
 */

// Single generic message for every login failure, whatever the real cause.
const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

function clientMeta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------
router.post('/register', authLimiter, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const { password, role } = req.body;

    // Validate. Note: only 'worker' and 'expert' may self-register. 'admin' is
    // never accepted here — admins are seeded/created out of band, so the
    // public cannot create a privileged account.
    if (!name || name.length > 255) {
      return res.status(400).json({ error: 'A valid name is required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    const pwErr = passwordPolicyError(password);
    if (pwErr) {
      return res.status(400).json({ error: pwErr });
    }
    if (role !== 'worker' && role !== 'expert') {
      return res.status(400).json({ error: 'Role must be worker or expert.' });
    }

    // Account-state gates per role:
    //   - worker: must verify email before login  -> is_verified starts FALSE
    //   - expert: must be approved by an admin     -> is_approved starts FALSE
    // (Email-verification token issuance is a later task; the column is set so
    //  the login gate already behaves correctly.)
    const isVerified = false;
    const isApproved = role === 'worker'; // workers don't need approval; experts do

    const passwordHash = await hashPassword(password);

    // Insert. The UNIQUE constraint on email is the source of truth for
    // duplicates. We catch the duplicate error below and return a GENERIC
    // message — telling the client "email already registered" would leak which
    // emails have accounts.
    try {
      const [result] = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, is_verified, is_approved)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, email, passwordHash, role, isVerified, isApproved]
      );
      audit.info('User registered', {
        context: 'auth', action: 'register', userId: result.insertId, role, ip: req.ip,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Same response shape as success — don't reveal the email is taken.
        return res.status(202).json({
          message: 'If the details are valid, your account has been created. Check your email or await approval.',
        });
      }
      throw err;
    }

    return res.status(202).json({
      message: 'If the details are valid, your account has been created. Check your email or await approval.',
    });
  } catch (err) {
    system.error('Registration failed', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Shared login handler, parameterised by whether this is the admin endpoint.
// ---------------------------------------------------------------------------
async function handleLogin(req, res, { adminOnly }) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!isValidEmail(email) || typeof password !== 'string' || !password) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const { result, user } = await authenticateUser(email, password);

    if (result !== AuthResult.SUCCESS) {
      // Log the REAL reason internally; return the GENERIC message externally.
      audit.info('Login failed', {
        context: 'auth', action: adminOnly ? 'admin_login' : 'login',
        email, reason: result, ip: req.ip,
      });
      // NOT_VERIFIED / NOT_APPROVED get a specific (non-enumerating) message so
      // a legitimate user knows to check email / await approval. These are only
      // reachable AFTER a correct password, so they don't leak account info.
      if (result === AuthResult.NOT_VERIFIED) {
        return res.status(403).json({ error: 'Please verify your email before logging in.' });
      }
      if (result === AuthResult.NOT_APPROVED) {
        return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
      }
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    // Separation of duties at the door:
    //   - public /login must REJECT admins (they use the admin endpoint)
    //   - admin /login must REJECT non-admins
    if (adminOnly && user.role !== 'admin') {
      audit.info('Admin endpoint used by non-admin', {
        context: 'auth', action: 'admin_login', userId: user.id, role: user.role, ip: req.ip,
      });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }
    if (!adminOnly && user.role === 'admin') {
      audit.info('Admin attempted public login endpoint', {
        context: 'auth', action: 'login', userId: user.id, ip: req.ip,
      });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const { accessToken, refreshToken } = await createSession(user, clientMeta(req));

    audit.info('Login success', {
      context: 'auth', action: adminOnly ? 'admin_login' : 'login',
      userId: user.id, role: user.role, ip: req.ip,
    });

    return res.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    system.error('Login error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

// PUBLIC login — workers and experts.
router.post('/login', authLimiter, (req, res) => handleLogin(req, res, { adminOnly: false }));

// ADMIN login — separate path, stricter limit, admins only.
router.post('/admin/login', adminAuthLimiter, (req, res) => handleLogin(req, res, { adminOnly: true }));

// ---------------------------------------------------------------------------
// LOGOUT — revoke the session tied to the supplied refresh token.
// ---------------------------------------------------------------------------
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await revokeSessionByRefreshToken(refreshToken);
    }
    // Always return success — logout should be idempotent and never error out.
    return res.json({ message: 'Logged out.' });
  } catch (err) {
    system.error('Logout error', { context: 'auth', error: err.message });
    return res.json({ message: 'Logged out.' });
  }
});

// ---------------------------------------------------------------------------
// REFRESH — exchange a valid, non-revoked, non-expired refresh token for a new
// access token. (Rotation of the refresh token itself can be added next; this
// validates against the stored hash and the revoked/expiry flags.)
// ---------------------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Missing refresh token.' });
    }

    const { hashToken } = require('../utils/tokens');
    const [rows] = await pool.query(
      `SELECT s.*, u.id AS uid, u.name, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = ? AND s.revoked = FALSE AND s.expires_at > NOW()
        LIMIT 1`,
      [hashToken(refreshToken)]
    );
    const session = rows[0];
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    const { issueAccessToken } = require('../utils/tokens');
    const user = { id: session.uid, name: session.name, role: session.role };
    const token = issueAccessToken(user);

    return res.json({ token, user });
  } catch (err) {
    system.error('Refresh error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Could not refresh session.' });
  }
});

module.exports = router;
