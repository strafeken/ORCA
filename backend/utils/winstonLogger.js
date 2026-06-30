const { createLogger, format, transports } = require('winston');
const LokiTransport = require('winston-loki');
const { sanitizeLog } = require('./sanitize');
const { categorizeAction } = require('./auditCategories');

const lokiUrl = process.env.LOKI_URL;

// System logger - logs to stdout (Alloy picks this up) AND pushes to Loki
//
// useCustomFormat: true on the LokiTransport here for the same reason as
// auditLogger below — without it, winston-loki glues meta fields onto the
// message as a JSON-stringified suffix instead of top-level keys. The
// Console transport is unaffected either way since it doesn't go through
// winston-loki's line builder, but the direct-to-Loki copy of system logs
// benefits from the same structured shape as audit logs.
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
      useCustomFormat: true,
    }),
  ],
});

// Audit logger - pushes DIRECTLY to Loki only, no stdout
// This ensures Alloy never sees it and relabels it as system
//
// FIX: winston-loki's LokiTransport defaults to building the stored line as
// `${message} ${JSON.stringify(rest)}` (see node_modules/winston-loki/index.js,
// the `useCustomFormat` branch) — i.e. it appends every meta field (userId,
// actionType, resourceType, resourceId, ip) as a single stringified JSON blob
// glued onto the end of the message, rather than emitting them as separate
// top-level keys. That is exactly why GET /api/admin/logs was seeing
// userId/actionType/resourceType/resourceId as null at the top level, with
// the real values buried inside `msg` as text.
//
// useCustomFormat: true switches the transport to use info[MESSAGE] instead —
// the single pre-serialized JSON string that format.json() already builds for
// us (and that the Console transport on systemLogger uses correctly). With
// this set, every field (userId, actionType, resourceType, resourceId, ip,
// level, timestamp) lands as a proper top-level JSON key on the stored Loki
// line, matching what admin.js's /logs route expects.
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
      useCustomFormat: true,
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
  /**
   * Logs a security/audit event.
   *
   * `category` is auto-derived from actionType via categorizeAction() — one
   * of 'Create' | 'Read' | 'Update' | 'Delete' | 'Login' | 'Other'. This is
   * computed and attached here (not just on read) so it's stored as a real
   * field on the Loki line going forward, available for Loki-side queries
   * too (not just client-side filtering after the fact). The admin /logs
   * route still re-derives category for any older entries that predate
   * this field, via the same categorizeAction() function imported there.
   *
   * `level` defaults to 'info' but callers can pass 'warn' for actions that
   * warrant standing out in the log viewer — account deletions, soft/hard
   * lockouts, and similar account-restricting or destructive operations.
   * This is independent of `category`: a Delete can be 'warn', a routine
   * Read stays 'info'. Only 'info' and 'warn' are supported here — actual
   * runtime errors belong in system.error(), not the audit trail.
   */
  log: ({ userId = null, actionType, resourceType = null, resourceId = null, ip = null, level = 'info' }) => {
    const meta = {
      userId,
      actionType: sanitizeLog(actionType),
      category: categorizeAction(actionType),
      resourceType: resourceType ? sanitizeLog(resourceType) : null,
      resourceId,
      ip: ip ? sanitizeLog(ip) : null,
    };

    if (level === 'warn') {
      auditLogger.warn(sanitizeLog(actionType), meta);
    } else {
      auditLogger.info(sanitizeLog(actionType), meta);
    }
  }
};

module.exports = { system, audit };