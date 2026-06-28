const pool = require('../db/pool').promise();
const { verifyPassword } = require('./password');
const {
  issueAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
} = require('./tokens');

/**
 * Authentication service — the single shared core used by BOTH the public
 * login route and the admin login route. Writing this once (instead of one copy
 * per route) means there is exactly one place where passwords are checked and
 * lockout is enforced: no risk of the two paths drifting apart, and the admin
 * path can't accidentally be the weaker one.
 *
 * Lockout model (columns already exist in the users table):
 *   - failed_attempts: running count of consecutive failures
 *   - soft lock: after SOFT_LOCK_THRESHOLD failures, the account is locked for
 *     SOFT_LOCK_MINUTES. This slows online guessing without permanently
 *     denying a legitimate user who fat-fingered their password.
 *   - hard lock: after HARD_LOCK_THRESHOLD failures, the account is locked
 *     until an admin intervenes. Stops a determined sustained attack.
 *   A successful login resets the counter and clears the soft lock.
 */

const SOFT_LOCK_THRESHOLD = 5;
const SOFT_LOCK_MINUTES = 15;
const HARD_LOCK_THRESHOLD = 10;

/**
 * Result codes returned to the route. The route maps ALL failure codes to the
 * same generic client message ("Email or password is incorrect") so we never
 * reveal whether the email exists, whether the password was wrong, or whether
 * the account is locked — all of which would help an attacker enumerate
 * accounts. The codes are for internal logging only.
 */
const AuthResult = {
  SUCCESS: 'SUCCESS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SOFT_LOCKED: 'SOFT_LOCKED',
  HARD_LOCKED: 'HARD_LOCKED',
  NOT_VERIFIED: 'NOT_VERIFIED',
  NOT_APPROVED: 'NOT_APPROVED',
};

/**
 * Core authentication. Does NOT issue tokens — it only decides whether the
 * credentials are good and the account is allowed in. Token/session creation is
 * a separate step (createSession) so the same check can be reused.
 *
 * @returns {{ result: string, user?: object }}
 */
async function authenticateUser(email, password) {
  // Look the user up by email. We always run the password verification path
  // even when the user doesn't exist (see below) to keep timing uniform.
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  const user = rows[0];

  // Account enumeration defense: if the email is unknown, we still perform a
  // verify against a dummy hash so the response time is similar whether or not
  // the account exists. Then return the same generic failure.
  if (!user) {
    await verifyPassword(
      '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      password
    );
    return { result: AuthResult.INVALID_CREDENTIALS };
  }

  // Hard lock: permanent until admin clears it. Checked before password so we
  // don't keep incrementing a locked account.
  if (user.is_hard_locked) {
    return { result: AuthResult.HARD_LOCKED };
  }

  // Soft lock: time-based. If the lock window is still active, reject. If it
  // has expired, we let the attempt proceed and clear the soft lock on success.
  if (user.is_soft_locked && user.soft_lock_until && new Date(user.soft_lock_until) > new Date()) {
    return { result: AuthResult.SOFT_LOCKED };
  }

  const passwordOk = await verifyPassword(user.password_hash, password);

  if (!passwordOk) {
    await registerFailedAttempt(user);
    return { result: AuthResult.INVALID_CREDENTIALS };
  }

  // Password is correct. Now enforce the account-state gates.
  // Workers must verify their email; experts must be approved by an admin.
  if (!user.is_verified) {
    return { result: AuthResult.NOT_VERIFIED };
  }
  if (user.role === 'expert' && !user.is_approved) {
    return { result: AuthResult.NOT_APPROVED };
  }

  // Success — reset the failure counter and clear any soft lock.
  await pool.query(
    `UPDATE users
       SET failed_attempts = 0, is_soft_locked = FALSE, soft_lock_until = NULL
     WHERE id = ?`,
    [user.id]
  );

  return { result: AuthResult.SUCCESS, user };
}

/**
 * Increment the failure counter and apply soft/hard locks as thresholds are
 * crossed. Done in a single UPDATE per state to keep it simple and atomic
 * enough for this scale.
 */
async function registerFailedAttempt(user) {
  const attempts = user.failed_attempts + 1;

  if (attempts >= HARD_LOCK_THRESHOLD) {
    await pool.query(
      `UPDATE users SET failed_attempts = ?, is_hard_locked = TRUE WHERE id = ?`,
      [attempts, user.id]
    );
    return;
  }

  if (attempts >= SOFT_LOCK_THRESHOLD) {
    const until = new Date(Date.now() + SOFT_LOCK_MINUTES * 60 * 1000);
    await pool.query(
      `UPDATE users
         SET failed_attempts = ?, is_soft_locked = TRUE, soft_lock_until = ?
       WHERE id = ?`,
      [attempts, until, user.id]
    );
    return;
  }

  await pool.query(
    `UPDATE users SET failed_attempts = ? WHERE id = ?`,
    [attempts, user.id]
  );
}

/**
 * Create a session for an authenticated user: issue a short-lived access token
 * and a long-lived refresh token, and store ONLY their hashes (plus request
 * metadata) in the sessions table. The raw tokens are returned to the caller to
 * send to the client; they are never persisted in raw form.
 *
 * source_ip and user_agent are recorded so the admin session view (Workstream
 * 5) can show where a session originated and terminate suspicious ones.
 */
async function createSession(user, { ip, userAgent }) {
  const accessToken = issueAccessToken(user);
  const refreshToken = generateRefreshToken();

  await pool.query(
    `INSERT INTO sessions
       (user_id, token_hash, refresh_token_hash, source_ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      hashToken(accessToken),
      hashToken(refreshToken),
      ip || null,
      userAgent || null,
      refreshExpiryDate(),
    ]
  );

  return { accessToken, refreshToken };
}

/**
 * Revoke a session by its refresh token (logout). We mark the row revoked
 * rather than delete it, so the admin audit/session history is preserved.
 */
async function revokeSessionByRefreshToken(refreshToken) {
  await pool.query(
    `UPDATE sessions SET revoked = TRUE WHERE refresh_token_hash = ?`,
    [hashToken(refreshToken)]
  );
}

module.exports = {
  authenticateUser,
  createSession,
  revokeSessionByRefreshToken,
  AuthResult,
  SOFT_LOCK_THRESHOLD,
  HARD_LOCK_THRESHOLD,
};
