/**
 * EventBus — a tiny synchronous publish/subscribe hub (Observer pattern).
 *
 * Services publish domain events; cross-cutting concerns (audit, notifications,
 * …) subscribe. This decouples "something happened" from "what we do about it":
 * a service records a login failure without knowing an AuditObserver exists.
 *
 * Handlers are wrapped in try/catch so a misbehaving observer can never break
 * the publisher — an audit-write failure must not fail the business action
 * (matching the existing fire-and-forget audit behaviour).
 */
class EventBus {
  constructor() {
    this.handlers = new Map(); // eventType -> handler[]  ('*' = every event)
  }

  subscribe(eventType, handler) {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, []);
    this.handlers.get(eventType).push(handler);
    return this;
  }

  /** Subscribe to every event regardless of type (used by the AuditObserver). */
  subscribeAll(handler) {
    return this.subscribe('*', handler);
  }

  publish(event) {
    const handlers = [
      ...(this.handlers.get(event.type) || []),
      ...(this.handlers.get('*') || []),
    ];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // An observer must never break the publisher; swallow and move on.
      }
    }
  }
}

module.exports = { EventBus };
