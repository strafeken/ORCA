const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');

/**
 * GET /api/users
 *
 * Previously this endpoint was completely unauthenticated and exposed every
 * user account to anyone who could reach the API. It is now gated to admins
 * only (SR-25, SR-26). The richer /api/admin/users endpoint is the canonical
 * admin tool; this one is retained for any legacy callers but returns only
 * the same fields and requires the same role check.
 */
router.get('/', authMiddleware, requireRole('admin'), (req, res) => {
  pool.query(
    'SELECT id, name, email, role, is_verified, is_approved, created_at FROM users ORDER BY created_at DESC',
    (err, results) => {
      if (err) {
        console.error('Query error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(results);
    }
  );
});

module.exports = router;