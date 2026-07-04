const { audit } = require('../../utils/winstonLogger');

/**
 * AuditObserver — subscribes to every domain event and writes it to the audit
 * trail (SR-29/SR-30). This is the single place audit entries are produced, so
 * a lane satisfies "every sensitive action emits an audit event" simply by
 * publishing an event — it never calls the logger directly.
 *
 * The audit logger is injected (defaulting to the real one) for testability.
 */
class AuditObserver {
  constructor(auditLogger = audit) {
    this.audit = auditLogger;
  }

  /** Register on a bus so every published event is audited. */
  register(bus) {
    bus.subscribeAll((event) => this.handle(event));
    return this;
  }

  handle(event) {
    const p = event.payload || {};
    this.audit.log({
      userId: p.userId,
      actionType: event.type,
      resourceType: p.resourceType,
      resourceId: p.resourceId,
      ip: p.ip,
      level: p.level || 'info',
    });
  }
}

module.exports = { AuditObserver };
