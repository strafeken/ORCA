const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', (req, res) => {
  res.json({ status: 'Backend is up!' });
});

router.get('/db', (req, res) => {
  pool.query('SELECT 1', (err) => {
    if (err) return res.status(500).json({ status: 'DB connection failed', error: err.message });
    res.json({ status: 'DB connected!' });
  });
});

module.exports = router;