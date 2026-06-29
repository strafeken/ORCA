const express = require('express');
const router = express.Router();

const LOKI_URL = process.env.LOKI_URL;

router.get('/logs', async (req, res) => {
  const { job = '', level = '', search = '', range = '1h' } = req.query;

  let query = '{app="orca"}';
  if (job) query = `{app="orca", job="${job}"}`;
  if (level) query += ` | json | level="${level}"`;
  if (search) query += ` |= \`${search}\``;

  try {
    const response = await fetch(
      `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&since=${range}&limit=200&direction=backward`
    );
    const data = await response.json();

    const logs = [];
    for (const stream of data.data?.result || []) {
      for (const [ts, line] of stream.values) {
        let parsed = {};
        try { parsed = JSON.parse(line); } catch { parsed = { msg: line }; }
        logs.push({
          ts: new Date(Number(ts) / 1e6).toISOString(),
          level: stream.stream?.level || parsed.level || 'info',
          job: stream.stream?.job || 'system',
          msg: parsed.message || parsed.msg || line,
          ip: parsed.ip || '—',
        });
      }
    }

    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;