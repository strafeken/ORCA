const express = require('express');
const router = express.Router();
const pool = require('../db/pool').promise();
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { verifyPassword, hashPassword, passwordPolicyError } = require('../utils/password');
const { audit } = require('../utils/winstonLogger');

/**
 * GET /api/users
 * Admin-only listing (SR-25, SR-26).
 */
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const [results] = await pool.query(
      'SELECT id, name, email, role, is_verified, is_approved, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(results);
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/me — FR-03, SR-26
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [results] = await pool.query(
      'SELECT id, name, email, contact_number, bio, role, is_verified, is_approved, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(results[0]);
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/users/me — FR-04, SR-12
 */
const UPDATABLE_FIELDS = ['name', 'contact_number', 'bio'];

router.patch('/me', authMiddleware, async (req, res) => {
  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates[field] = req.body[field];
    }
  }

  const fields = Object.keys(updates);
  if (fields.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided.' });
  }

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => updates[f]);

  try {
    await pool.query(`UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ?`, [
      ...values,
      req.user.id,
    ]);

    // SR-29: a profile update is a state-changing action on the user's own
    // account and must be recorded in the audit trail. Previously this route
    // returned successfully without logging anything, so profile edits were
    // invisible in the audit log. resourceId is the affected user (self here);
    // the changed field names go to the audit meta so a reviewer can see WHAT
    // was updated without exposing the new values themselves.
    audit.log({
      userId: req.user.id,
      actionType: 'profile_updated',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: req.ip,
    });

    const [results] = await pool.query(
      'SELECT id, name, email, contact_number, bio, role, is_verified, is_approved, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(results[0]);
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/users/me/reauth
 */
router.post('/me/reauth', authMiddleware, async (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const ok = await verifyPassword(rows[0].password_hash, password);
    if (!ok) {
      audit.log({ userId: req.user.id, actionType: 'reauth_failed', resourceType: 'user', ip: req.ip });
      return res.status(403).json({ error: 'Incorrect password.' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Reauth error:', err);
    res.status(500).json({ error: 'Could not verify password.' });
  }
});

/**
 * PATCH /api/users/me/password
 */
router.patch('/me/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'Current password is required.' });
  }

  const pwErr = passwordPolicyError(newPassword);
  if (pwErr) {
    return res.status(400).json({ error: pwErr });
  }

  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const ok = await verifyPassword(rows[0].password_hash, currentPassword);
    if (!ok) {
      audit.log({ userId: req.user.id, actionType: 'password_change_failed', resourceType: 'user', ip: req.ip });
      return res.status(403).json({ error: 'Incorrect current password.' });
    }

    const isSameAsOld = await verifyPassword(rows[0].password_hash, newPassword);
    if (isSameAsOld) {
      return res.status(400).json({ error: 'New password must be different from your current password.' });
    }

    const newHash = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [
      newHash,
      req.user.id,
    ]);

    const { hashToken } = require('../utils/tokens');
    const authHeader = req.headers['authorization'];
    const currentTokenHash = hashToken(authHeader.split(' ')[1]);

    await pool.query('UPDATE sessions SET revoked = TRUE WHERE user_id = ? AND token_hash != ?', [
      req.user.id,
      currentTokenHash,
    ]);

    audit.log({ userId: req.user.id, actionType: 'password_changed', resourceType: 'user', ip: req.ip });

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

/**
 * DELETE /api/users/me
 */
router.delete('/me', authMiddleware, async (req, res) => {
  // Admins cannot self-delete. Account deletion is an admin-only action applied
  // to OTHER users through the admin console (routes/admin.js also blocks an
  // admin deleting their own row). Enforcing it here — not just by hiding the
  // /adm/account/delete page — is the real boundary (SR-25): the endpoint must
  // reject a direct API call, otherwise removing the UI achieves nothing. (FR-05)
  if (req.user.role === 'admin') {
    audit.log({ userId: req.user.id, actionType: 'account_delete_denied_admin', resourceType: 'user', ip: req.ip, level: 'warn' });
    return res.status(403).json({ error: 'Administrators cannot delete their own account.' });
  }

  const { password } = req.body;
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  let conn;

  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const ok = await verifyPassword(rows[0].password_hash, password);
    if (!ok) {
      audit.log({ userId: req.user.id, actionType: 'account_delete_failed', resourceType: 'user', ip: req.ip });
      return res.status(403).json({ error: 'Incorrect password.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Delete child records first
    await conn.query(
      'DELETE FROM email_verification_tokens WHERE user_id = ?',
      [req.user.id]
    );

    await conn.query(
      'DELETE FROM password_reset_tokens WHERE user_id = ?',
      [req.user.id]
    );

    await conn.query(
      'DELETE FROM sessions WHERE user_id = ?',
      [req.user.id]
    );

    await conn.query(
      'DELETE FROM totp_secrets WHERE user_id = ?',
      [req.user.id]
    );

    // Finally delete the user
    await conn.query(
      'DELETE FROM users WHERE id = ?',
      [req.user.id]
    );

    await conn.commit();

    // level: 'warn' — a self-service account deletion is a permanent,
    // irreversible destruction of the record, exactly like the admin-initiated
    // ADMIN_DELETE_USER path. It should stand out in the audit log viewer
    // rather than blend in with routine info-level activity.
    audit.log({
      userId: req.user.id,
      actionType: 'account_deleted',
      resourceType: 'user',
      ip: req.ip,
      level: 'warn'
    });

    res.json({ message: 'Account deleted.' });

  } catch (err) {
    if (conn) await conn.rollback();

    console.error('Account deletion error:', err);
    res.status(500).json({ error: 'Could not delete account.' });

  } finally {
    if (conn) conn.release();
  }
});


/**
 * GET /api/users/me/2fa
 */
router.get('/me/2fa', authMiddleware, async (req, res) => {
  try {
    // Only a CONFIRMED secret counts as 2FA enabled. A row that exists but was
    // never confirmed (setup started, code never entered) reports as disabled,
    // matching what login enforces via hasTotp.
    const [rows] = await pool.query(
      'SELECT confirmed_at FROM totp_secrets WHERE user_id = ? AND confirmed_at IS NOT NULL LIMIT 1',
      [req.user.id]
    );
    if (!rows.length) {
      return res.json({ enabled: false, since: null });
    }
    res.json({ enabled: true, since: rows[0].confirmed_at });
  } catch (err) {
    console.error('2FA status error:', err);
    res.status(500).json({ error: 'Could not load 2FA status.' });
  }
});

module.exports = router;