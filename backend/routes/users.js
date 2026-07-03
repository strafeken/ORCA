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

    audit.log({
      userId: req.user.id,
      actionType: 'account_deleted',
      resourceType: 'user',
      ip: req.ip
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

const { hasTotp } = require('../utils/totp');

/**
 * GET /api/users/me/2fa
 */
router.get('/me/2fa', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT created_at FROM totp_secrets WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    if (!rows.length) {
      return res.json({ enabled: false, since: null });
    }
    res.json({ enabled: true, since: rows[0].created_at });
  } catch (err) {
    console.error('2FA status error:', err);
    res.status(500).json({ error: 'Could not load 2FA status.' });
  }
});

module.exports = router;