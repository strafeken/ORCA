// AuditObserver module-loads the winston/loki logger; mock it so the suite
// doesn't need a live Loki URL. (Handlers are injected below regardless.)
jest.mock('../utils/winstonLogger', () => ({
  audit: { log: jest.fn() },
  system: { error: jest.fn(), info: jest.fn() },
}));

const { EventBus } = require('../domain/events/EventBus');
const { DomainEvent } = require('../domain/events/DomainEvent');
const { AuditObserver } = require('../domain/events/AuditObserver');

describe('EventBus', () => {
  test('delivers an event to a type-specific subscriber', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('X', handler);
    const evt = new DomainEvent('X', { a: 1 });
    bus.publish(evt);
    expect(handler).toHaveBeenCalledWith(evt);
  });

  test('delivers every event to a wildcard subscriber', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribeAll(handler);
    bus.publish(new DomainEvent('A'));
    bus.publish(new DomainEvent('B'));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('a throwing subscriber does not break the publisher or other subscribers', () => {
    const bus = new EventBus();
    const good = jest.fn();
    bus.subscribeAll(() => { throw new Error('boom'); });
    bus.subscribeAll(good);
    expect(() => bus.publish(new DomainEvent('A'))).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  test('does not deliver an event to a subscriber of a different type', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('X', handler);
    bus.publish(new DomainEvent('Y'));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('AuditObserver', () => {
  test('maps a published event to an audit.log entry with all fields', () => {
    const bus = new EventBus();
    const fakeAudit = { log: jest.fn() };
    new AuditObserver(fakeAudit).register(bus);

    bus.publish(new DomainEvent('ACCOUNT_HARD_LOCKED', {
      userId: 5, resourceType: 'user', resourceId: 5, ip: '1.2.3.4', level: 'warn',
    }));

    expect(fakeAudit.log).toHaveBeenCalledWith({
      userId: 5, actionType: 'ACCOUNT_HARD_LOCKED', resourceType: 'user',
      resourceId: 5, ip: '1.2.3.4', level: 'warn',
    });
  });

  test('defaults level to info when the event omits it', () => {
    const bus = new EventBus();
    const fakeAudit = { log: jest.fn() };
    new AuditObserver(fakeAudit).register(bus);

    bus.publish(new DomainEvent('login_success', { userId: 1 }));

    expect(fakeAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'login_success', level: 'info' })
    );
  });
});
