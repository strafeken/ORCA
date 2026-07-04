const pool = require('../db/pool').promise();

/**
 * SessionRepository — all data access to the `sessions` table in one place
 * (Repository pattern). Services depend on these intent-named methods instead
 * of embedding SQL, which keeps the SQL in one auditable spot and lets services
 * be unit-tested against a fake repository.
 *
 * SQL is kept byte-for-byte identical to the previous inline queries so
 * behaviour (and the existing authService tests that assert the exact SQL) is
 * unchanged.
 */
class SessionRepository {
  /**
   * Lazily revoke this user's sessions that have gone idle past the inactivity
   * timeout (closed tab, never logged out) so a stale row can't lock them out.
   */
  async sweepIdleSessions(userId, inactivityMinutes) {
    await pool.query(
      `UPDATE sessions
          SET revoked = TRUE
        WHERE user_id = ?
          AND revoked = FALSE
          AND last_activity < (NOW() - INTERVAL ${inactivityMinutes} MINUTE)`,
      [userId]
    );
  }

  /** Count this user's still-live sessions (not revoked, not past the 2-h cap). */
  async countLiveSessions(userId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS active
         FROM sessions
        WHERE user_id = ?
          AND revoked = FALSE
          AND expires_at > NOW()`,
      [userId]
    );
    return rows[0].active;
  }

  /** Persist a new session. Only token HASHES are stored (SR-18), never raw tokens. */
  async create({ userId, tokenHash, refreshTokenHash, sourceIp, userAgent, expiresAt }) {
    await pool.query(
      `INSERT INTO sessions
         (user_id, token_hash, refresh_token_hash, source_ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, tokenHash, refreshTokenHash, sourceIp, userAgent, expiresAt]
    );
  }

  async revokeByRefreshHash(refreshTokenHash) {
    await pool.query(
      `UPDATE sessions SET revoked = TRUE WHERE refresh_token_hash = ?`,
      [refreshTokenHash]
    );
  }

  async revokeByAccessHash(tokenHash) {
    await pool.query(
      `UPDATE sessions SET revoked = TRUE WHERE token_hash = ?`,
      [tokenHash]
    );
  }

  // ---- Per-request / per-event session validation (authMiddleware, guards) ----

  /**
   * Look up an unrevoked session by its access-token hash. Returns the row
   * (id, revoked, last_activity) so the caller can apply its own idle-timeout
   * policy, or null if none. Used by the HTTP authMiddleware.
   */
  async findByTokenHash(tokenHash) {
    const [rows] = await pool.query(
      `SELECT id, revoked, last_activity FROM sessions
        WHERE token_hash = ? AND revoked = FALSE
        LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  /**
   * Look up a live session (unrevoked AND within the 2-hour absolute cap) by
   * access-token hash. Returns (id, last_activity) or null. Used by the socket
   * handshake guard.
   */
  async findLiveByTokenHash(tokenHash) {
    const [rows] = await pool.query(
      `SELECT id, last_activity FROM sessions
        WHERE token_hash = ? AND revoked = FALSE AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  /** Is this session id still live (unrevoked, within the absolute cap)? */
  async isLiveById(sessionId) {
    const [rows] = await pool.query(
      'SELECT id FROM sessions WHERE id = ? AND revoked = FALSE AND expires_at > NOW() LIMIT 1',
      [sessionId]
    );
    return rows.length > 0;
  }

  /** Revoke a single session by id (idle-expiry). */
  async revokeById(sessionId) {
    await pool.query('UPDATE sessions SET revoked = TRUE WHERE id = ?', [sessionId]);
  }

  /** Slide the inactivity window forward on a real user-initiated request. */
  async touch(sessionId) {
    await pool.query('UPDATE sessions SET last_activity = NOW() WHERE id = ?', [sessionId]);
  }
}

module.exports = { SessionRepository };
