const express = require('express');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const { globalLimiter } = require('./middleware/rateLimiter');
const { httpLogger } = require('./utils/logger');
const { system } = require('./utils/winstonLogger');

const app = express();
app.set('trust proxy', 1);

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => {
    if (!process.env.CSRF_SECRET) {
      system.error("CSRF_SECRET is missing from environment variables!", { context: "bootstrap" });
      return "temporary-dev-secret-string-replace-this";
    }
    return process.env.CSRF_SECRET;
  },
  cookieName: '__Host-orca.x-csrf-token',
  cookieOptions: { sameSite: 'strict', secure: true, httpOnly: true, path: '/' },
  getSessionIdentifier: (req) => req.cookies['__Host-orca.refresh-token'] || 'anonymous_context',
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

app.use(cookieParser());
app.use(express.json());
app.use(httpLogger);
app.use(globalLimiter);

app.get('/api/csrf-token', (req, res) => {
  const csrfToken = generateCsrfToken(req, res);
  res.json({ csrfToken });
});

app.use(doubleCsrfProtection);

app.use('/api/health', require('./routes/health'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/authExtras'));
app.use('/api/voip', require('./routes/voip'));

app.use((err, req, res, _next) => {
  if (err.code === 'BADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  system.error('Internal server error caught by global handler', {
    context: 'express', error: err.message, stack: err.stack,
  });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;