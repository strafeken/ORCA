// AuditObserver imports the real winstonLogger, which connects to Loki on load.
// Mock it so the module loads cleanly in the test environment.
jest.mock('../utils/winstonLogger', () => ({
  audit: { log: jest.fn() },
  system: { info: jest.fn(), error: jest.fn() },
}));

const { DomainEvent } = require('../domain/events/DomainEvent');
const { AuditObserver } = require('../domain/events/AuditObserver');

/**
 * Tests for the domain-event audit path (SR-29 audit logging, SR-30 append-only
 * trail). Every sensitive action publishes a DomainEvent; the AuditObserver is
 * the single sink that turns those events into audit-log entries. Verifying
 * this mapping proves that publishing an event reliably produces a correctly
 * shaped audit record.
 */
describe('DomainEvent', () => {
  test('captures type, payload, and an occurredAt timestamp', () => {
    const e = new DomainEvent('login_failed', { userId: 1, ip: '1.2.3.4' });
    expect(e.type).toBe('login_failed');
    expect(e.payload.userId).toBe(1);
    expect(e.occurredAt).toBeInstanceOf(Date);
  });

  test('defaults payload to an empty object', () => {
    const e = new DomainEvent('SOMETHING');
    expect(e.payload).toEqual({});
  });
});

describe('AuditObserver (SR-29)', () => {
  function makeLogger() {
    return { log: jest.fn() };
  }

  test('maps a domain event to an audit.log call with the expected fields', () => {
    const logger = makeLogger();
    const observer = new AuditObserver(logger);
    observer.handle(new DomainEvent('ACCOUNT_HARD_LOCKED', {
      userId: 5, resourceType: 'user', resourceId: 5, ip: '9.9.9.9', level: 'warn',
    }));

    expect(logger.log).toHaveBeenCalledWith({
      userId: 5,
      actionType: 'ACCOUNT_HARD_LOCKED',
      resourceType: 'user',
      resourceId: 5,
      ip: '9.9.9.9',
      level: 'warn',
    });
  });

  test('defaults level to "info" when not supplied', () => {
    const logger = makeLogger();
    new AuditObserver(logger).handle(new DomainEvent('login_success', { userId: 2 }));
    expect(logger.log.mock.calls[0][0].level).toBe('info');
  });

  test('register() subscribes to all events on the bus', () => {
    const logger = makeLogger();
    const bus = { subscribeAll: jest.fn() };
    const observer = new AuditObserver(logger).register(bus);
    expect(bus.subscribeAll).toHaveBeenCalledTimes(1);
    expect(typeof bus.subscribeAll.mock.calls[0][0]).toBe('function');
    // The subscribed callback should forward to handle().
    const cb = bus.subscribeAll.mock.calls[0][0];
    cb(new DomainEvent('test_event', { userId: 1 }));
    expect(logger.log).toHaveBeenCalled();
    expect(observer).toBeInstanceOf(AuditObserver);
  });
});
