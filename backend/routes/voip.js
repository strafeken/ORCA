const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');

router.get("/turn-credentials", authMiddleware, (req, res) => {
    // This block is now fully protected. If a request hits this line, 
    // it means the token was successfully validated and req.user is populated
    res.json([
        {
            urls: "stun:stun.relay.metered.ca:80",
        },
        {
            urls: "turn:global.relay.metered.ca:80",
            username: process.env.METERED_USERNAME,
            credential: process.env.METERED_CREDENTIAL,
        },
        {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: process.env.METERED_USERNAME,
            credential: process.env.METERED_CREDENTIAL,
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: process.env.METERED_USERNAME,
            credential: process.env.METERED_CREDENTIAL,
        },
        {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: process.env.METERED_USERNAME,
            credential: process.env.METERED_CREDENTIAL,
        },
    ]);
});

module.exports = router;