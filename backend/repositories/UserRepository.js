const pool = require('../db/pool').promise();

// Soft-deleted accounts have their email suffixed with this marker; they must
// never surface in listings.
const DELETED_EMAIL_SUFFIX = '@orca-deleted';

/**
 * UserRepository — data access to the `users` table (Repository pattern).
 *
 * Only the queries the auth flow needs live here for now (lookup + lockout
 * counters). SQL is kept byte-for-byte identical to the previous inline queries
 * in authService so behaviour — and the tests that assert the exact UPDATEs —
 * is unchanged.
 */
class UserRepository {
  async findByEmail(email) {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    return rows[0] || null;
  }

  /** On a successful login: clear the failure counter and any soft lock. */
  async resetFailedAttempts(userId) {
    await pool.query(
      `UPDATE users
         SET failed_attempts = 0, is_soft_locked = FALSE, soft_lock_until = NULL
       WHERE id = ?`,
      [userId]
    );
  }

  async incrementFailedAttempts(userId, attempts) {
    await pool.query(
      `UPDATE users SET failed_attempts = ? WHERE id = ?`,
      [attempts, userId]
    );
  }

  async applySoftLock(userId, attempts, until) {
    await pool.query(
      `UPDATE users
         SET failed_attempts = ?, is_soft_locked = TRUE, soft_lock_until = ?
       WHERE id = ?`,
      [attempts, until, userId]
    );
  }

  async applyHardLock(userId, attempts) {
    await pool.query(
      `UPDATE users SET failed_attempts = ?, is_hard_locked = TRUE WHERE id = ?`,
      [attempts, userId]
    );
  }

  /** Approved, non-locked, non-deleted experts for the directory (FR-06). */
  async findApprovedExperts() {
    const [rows] = await pool.query(
      `SELECT id, name, email, bio, contact_number
         FROM users
        WHERE role = 'expert'
          AND is_approved = TRUE
          AND is_hard_locked = FALSE
          AND email NOT LIKE ?
        ORDER BY name ASC`,
      [`%${DELETED_EMAIL_SUFFIX}`]
    );
    return rows;
  }
}

module.exports = { UserRepository };
