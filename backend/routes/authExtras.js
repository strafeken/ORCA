const express = require('express');
const router = express.Router();
const pool = require('../db/pool').promise();

const { hashPassword, verifyPassword } = require('../utils/password');
const { issueToken, consumeToken, peekToken } = require('../utils/oneTimeTokens');
const { sendActionEmail } = require('../utils/mailer');
const { setupTotp, confirmTotp, verifyTotp, hasTotp, disableTotp } = require('../utils/totp');
const { authMiddleware } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/authRateLimiter');
const { system } = require('../utils/winstonLogger');
const { eventBus, DomainEvent } = require('../domain/events');

const APP_URL = process.env.APP_URL || 'http://localhost';

/**
 * Extra auth routes — mounted under /api/auth alongside the core routes.
 *
 *   GET  /verify-email?token=...     confirm email (sets is_verified)
 *   POST /resend-verification        re-send the verification link
 *   POST /forgot-password            request a password reset link
 *   POST /reset-password             set a new password using a reset token
 *   POST /totp/setup                 (auth) begin TOTP setup, returns QR
 *   POST /totp/enable                (auth) confirm a code to enable TOTP
 *   POST /totp/disable               (auth) turn TOTP off
 *
 * Shared rules: parameterised queries, generic responses that don't reveal
 * whether an account exists, single-use + time-limited tokens.
 */

function isValidEmail(email) {
  // Linear-time validation (no backtracking) to avoid ReDoS. We cap the length
  // first, then use a bounded character-class regex with no nested quantifiers.
  if (typeof email !== 'string' || email.length > 254) return false;
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,255}$/.test(email);
}

function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters.';
  }
  if (password.length > 128) return 'Password is too long.';
  return null;
}

// ---------------------------------------------------------------------------
// EMAIL VERIFICATION
// ---------------------------------------------------------------------------
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    const userId = await consumeToken('verification', token);
    if (!userId) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
    }
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = ?', [userId]);
    eventBus.publish(new DomainEvent('email_verified', { userId, ip: req.ip }));
    return res.json({ message: 'Email verified. You can now log in.' });
  } catch (err) {
    system.error('Verify-email error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

router.post('/resend-verification', authLimiter, async (req, res) => {
  // Always return the same generic response — never reveal whether the email
  // exists or is already verified.
  const generic = { message: 'If an unverified account exists for that email, a new link has been sent.' };
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return res.json(generic);

    const [rows] = await pool.query(
      'SELECT id, name, is_verified FROM users WHERE email = ? LIMIT 1', [email]
    );
    const user = rows[0];
    if (user && !user.is_verified) {
      const token = await issueToken('verification', user.id);
      const link = `${APP_URL}/verify-email?token=${token}`;
      await sendActionEmail({
        to: email,
        subject: 'Verify your ORCA account',
        heading: 'Confirm your email',
        body: `Hi ${user.name}, here is a new link to confirm your email address.`,
        link,
        buttonText: 'Verify email',
      });
    }
    return res.json(generic);
  } catch (err) {
    system.error('Resend-verification error', { context: 'auth', error: err.message });
    return res.json(generic);
  }
});

// ---------------------------------------------------------------------------
// PASSWORD RESET
// ---------------------------------------------------------------------------
router.post('/forgot-password', authLimiter, async (req, res) => {
  // Generic response regardless of whether the account exists (anti-enumeration).
  const generic = { message: 'If an account exists for that email, a reset link has been sent.' };
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return res.json(generic);

    const [rows] = await pool.query(
      'SELECT id, name FROM users WHERE email = ? LIMIT 1', [email]
    );
    const user = rows[0];
    if (user) {
      const token = await issueToken('reset', user.id);
      const link = `${APP_URL}/reset-password?token=${token}`;
      await sendActionEmail({
        to: email,
        subject: 'Reset your ORCA password',
        heading: 'Password reset',
        body: `Hi ${user.name}, click below to set a new password. This link expires in 1 hour.`,
        link,
        buttonText: 'Reset password',
      });
      eventBus.publish(new DomainEvent('password_reset_requested', { userId: user.id, ip: req.ip }));
    }
    return res.json(generic);
  } catch (err) {
    system.error('Forgot-password error', { context: 'auth', error: err.message });
    return res.json(generic);
  }
});

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    const pwErr = passwordPolicyError(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    // Peek first (non-destructive) so a "same as old password" rejection
    // doesn't burn the user's single-use reset link — they can just try a
    // different password with the same link.
    const peekedUserId = await peekToken('reset', token);
    if (!peekedUserId) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [peekedUserId]);
    if (rows.length && (await verifyPassword(rows[0].password_hash, password))) {
      return res.status(400).json({ error: 'New password must be different from your previous password.' });
    }

    const userId = await consumeToken('reset', token);
    if (!userId) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const passwordHash = await hashPassword(password);
    await pool.query(
      `UPDATE users
         SET password_hash = ?, failed_attempts = 0,
             is_soft_locked = FALSE, soft_lock_until = NULL
       WHERE id = ?`,
      [passwordHash, userId]
    );

    // Security: invalidate all existing sessions on password change, so a
    // previously-stolen session can't survive a reset.
    await pool.query('UPDATE sessions SET revoked = TRUE WHERE user_id = ?', [userId]);

    eventBus.publish(new DomainEvent('password_reset_completed', { userId, ip: req.ip }));
    return res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    system.error('Reset-password error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// TOTP (2FA) — all require an authenticated session.
// ---------------------------------------------------------------------------
router.post('/totp/setup', authMiddleware, async (req, res) => {
  try {
    const { qrDataUrl } = await setupTotp(req.user);
    // Not enabled yet — the user must confirm a code via /totp/enable.
    return res.json({ qr: qrDataUrl, message: 'Scan the QR code, then submit a code to enable.' });
  } catch (err) {
    system.error('TOTP setup error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Could not start TOTP setup.' });
  }
});

router.post('/totp/enable', authMiddleware, async (req, res) => {
  try {
    const { totp } = req.body;
    const ok = await verifyTotp(req.user.id, totp);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid code. Make sure your device clock is correct.' });
    }
    // The secret already exists (from setup); a verified code confirms it works.
    // Mark it confirmed — this is the point at which 2FA becomes active and
    // login will start requiring a code (hasTotp only counts confirmed secrets).
    await confirmTotp(req.user.id);
    eventBus.publish(new DomainEvent('totp_enabled', { userId: req.user.id, ip: req.ip }));
    return res.json({ message: 'Two-factor authentication enabled.' });
  } catch (err) {
    system.error('TOTP enable error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Could not enable TOTP.' });
  }
});

router.post('/totp/disable', authMiddleware, async (req, res) => {
  try {
    // Require a current code to disable, so a hijacked session can't silently
    // remove the second factor.
    const { totp } = req.body;
    if (await hasTotp(req.user.id)) {
      const ok = await verifyTotp(req.user.id, totp);
      if (!ok) return res.status(400).json({ error: 'Invalid code.' });
    }
    await disableTotp(req.user.id);
    eventBus.publish(new DomainEvent('totp_disabled', { userId: req.user.id, ip: req.ip }));
    return res.json({ message: 'Two-factor authentication disabled.' });
  } catch (err) {
    system.error('TOTP disable error', { context: 'auth', error: err.message });
    return res.status(500).json({ error: 'Could not disable TOTP.' });
  }
});

module.exports = router;
