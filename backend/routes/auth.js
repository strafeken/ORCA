const express = require('express');
const router = express.Router();
const { issueFakeToken } = require('../utils/fakeAuth');

// GET /api/auth/fake-login?userId=user-1
router.get('/fake-login', (req, res) => {
  const { userId } = req.query;
  try {
    const token = issueFakeToken(userId);
    res.json({ token, userId });
  } catch {
    res.status(400).json({ error: 'Invalid userId. Use user-1 or user-2.' });
  }
});

module.exports = router;