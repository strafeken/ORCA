const { createLogger, format, transports } = require('winston');
const LokiTransport = require('winston-loki');
const { sanitizeLog } = require('./sanitize');

const lokiUrl = process.env.LOKI_URL;

// System logger - logs to stdout (Alloy picks this up) AND pushes to Loki
const systemLogger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console(), // stdout → Alloy → Loki {job="system"}
    new LokiTransport({
      host: lokiUrl,
      labels: { job: 'system', app: 'orca' },
      batching: true,
      interval: 5,
      silenceErrors: true,
    }),
  ],
});

// Audit logger - pushes DIRECTLY to Loki only, no stdout
// This ensures Alloy never sees it and relabels it as system
const auditLogger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new LokiTransport({
      host: lokiUrl,
      labels: { job: 'audit', app: 'orca' },
      batching: true,
      interval: 5,
      silenceErrors: true,
    }),
    // No Console transport here — audit logs must not hit stdout
  ],
});

const system = {
  info: (message, meta = {}) => {
    systemLogger.info(sanitizeLog(message), meta);
  },
  error: (message, meta = {}) => {
    systemLogger.error(sanitizeLog(message), meta);
  }
};

const audit = {
  log: ({ userId = null, actionType, resourceType = null, resourceId = null, ip = null }) => {
    auditLogger.info(sanitizeLog(actionType), {
      userId,
      actionType: sanitizeLog(actionType),
      resourceType: resourceType ? sanitizeLog(resourceType) : null,
      resourceId,
      ip: ip ? sanitizeLog(ip) : null,
    });
  }
};

module.exports = { system, audit };