const fs = require('node:fs');
const path = require('node:path');
const morgan = require('morgan');

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);

const httpLogger = morgan('combined', { stream: accessLogStream });

module.exports = { httpLogger };