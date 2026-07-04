/**
 * DomainEvent — a something-happened fact published to the EventBus.
 *
 * `type` is the action name (e.g. 'ACCOUNT_HARD_LOCKED', 'login_failed') and
 * doubles as the audit actionType. `payload` carries the audit fields the
 * observer needs: { userId, resourceType, resourceId, ip, level }. Specific
 * events can subclass this, but the type string is the identity.
 */
class DomainEvent {
  constructor(type, payload = {}) {
    this.type = type;
    this.payload = payload;
    this.occurredAt = new Date();
  }
}

module.exports = { DomainEvent };
