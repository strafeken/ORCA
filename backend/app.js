const express = require('express');
const { globalLimiter } = require('./middleware/rateLimiter');
const { httpLogger } = require('./utils/logger');
const { system } = require('./utils/winstonLogger');
const app = express();

app.set('trust proxy', 1); // trust first proxy (Nginx)

app.use(express.json());
app.use(httpLogger);
app.use(globalLimiter);

app.use('/api/health', require('./routes/health'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/voip', require('./routes/voip'));

app.use((err, req, res, _next) => {
  system.error('Internal server error caught by global handler', { context: 'express', error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' }); // HTTP Response
});

module.exports = app;