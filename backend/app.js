const express = require('express');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const { globalLimiter } = require('./middleware/rateLimiter');
const { httpLogger } = require('./utils/logger');
const { system } = require('./utils/winstonLogger');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => {
    if (!process.env.CSRF_SECRET) {
      system.error("CSRF_SECRET is missing from environment variables!", {
        context: "bootstrap"
      });
      throw new Error("CSRF_SECRET is required");
    }

    return process.env.CSRF_SECRET;
  },
  cookieName: '__Host-orca.x-csrf-token',
  cookieOptions: { sameSite: 'strict', secure: true, httpOnly: true, path: '/' },
  getSessionIdentifier: (req) =>
    req.headers['x-refresh-token']
    || req.body?.refreshToken
    || req.cookies['__Host-orca.refresh-token']
    || 'anonymous_context',
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

app.use('/api/health', require('./routes/health'));

app.use(doubleCsrfProtection);

app.use('/api/users', require('./routes/users'));
app.use('/api/experts', require('./routes/experts'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/conversations', require('./routes/files'));
app.use('/api/files', require('./routes/annotations'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/authExtras'));
app.use('/api/voip', require('./routes/voip'));

app.use((err, req, res, _next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    // Generic user-facing text — don't confirm the CSRF mechanism to a caller.
    // The `code` field is a machine-readable signal (not shown to the user) that
    // the frontend uses to transparently fetch a fresh token and retry once
    // (see frontend/src/auth/api.js).
    return res.status(403).json({
      error: 'Your request could not be verified. Please refresh and try again.',
      code: 'CSRF_INVALID',
    });
  }
  system.error('Internal server error caught by global handler', {
    context: 'express', error: err.message, stack: err.stack,
  });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;