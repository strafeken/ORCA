const { EventBus } = require('./EventBus');
const { AuditObserver } = require('./AuditObserver');
const { DomainEvent } = require('./DomainEvent');

/**
 * The application's shared event bus, with the AuditObserver already
 * subscribed. Services import { eventBus, DomainEvent } and publish; the audit
 * trail is written automatically. Additional observers (notifications, metrics)
 * can be registered here later without touching any publisher.
 */
const eventBus = new EventBus();
new AuditObserver().register(eventBus);

module.exports = { eventBus, DomainEvent };
