const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { system } = require('../utils/winstonLogger');

router.get('/', (req, res) => {
  res.json({ status: 'Backend is up!' });
});

router.get('/db', (req, res) => {
  pool.query('SELECT 1', (err) => {
    if (err) {
      // Log the real driver error server-side; never return it to the client —
      // DB error strings can leak schema/host details.
      system.error('Health check DB query failed', { context: 'health', error: err.message });
      return res.status(500).json({ status: 'DB connection failed' });
    }
    res.json({ status: 'DB connected!' });
  });
});

module.exports = router;