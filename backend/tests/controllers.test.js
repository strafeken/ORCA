jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
  audit: { log: jest.fn() },
}));

const { ExpertController } = require('../controllers/ExpertController');
const { ConversationController } = require('../controllers/ConversationController');

/**
 * Tests for the HTTP controllers. Services are injected as fakes, so these
 * verify the request/response contract and — importantly — the input
 * validation that guards the business layer:
 *   - conversation id / expert id must be valid positive integers (SR-07)
 *   - a user cannot start a consultation with themselves
 *   - service failures map to 500 without leaking internals
 */
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('ExpertController (FR-06)', () => {
  test('list returns experts from the service', async () => {
    const service = { listApprovedExperts: jest.fn().mockResolvedValue([{ id: 1 }]) };
    const controller = new ExpertController(service);
    const res = mockRes();
    await controller.list({}, res);
    expect(res.body).toEqual({ experts: [{ id: 1 }] });
  });

  test('list maps a service error to 500', async () => {
    const service = { listApprovedExperts: jest.fn().mockRejectedValue(new Error('db')) };
    const controller = new ExpertController(service);
    const res = mockRes();
    await controller.list({}, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('ConversationController (FR-07, SR-07)', () => {
  function makeController(serviceOverrides = {}) {
    const service = {
      listForUser: jest.fn().mockResolvedValue([]),
      startConversation: jest.fn(),
      getConversation: jest.fn(),
      ...serviceOverrides,
    };
    return { controller: new ConversationController(service), service };
  }

  test('create rejects a non-integer expert id (SR-07)', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.create({ body: { expertId: 'abc' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(400);
  });

  test('create rejects starting a consultation with yourself', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.create({ body: { expertId: 5 }, user: { id: 5 } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  test('create returns 404 when the expert is not available', async () => {
    const { controller } = makeController({ startConversation: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await controller.create({ body: { expertId: 5 }, user: { id: 1 }, app: { get: () => null } }, res);
    expect(res.statusCode).toBe(404);
  });

  test('create returns 201 for a newly created conversation', async () => {
    const { controller } = makeController({
      startConversation: jest.fn().mockResolvedValue({ created: true, conversation: { id: 9 } }),
    });
    const res = mockRes();
    await controller.create(
      { body: { expertId: 5 }, user: { id: 1 }, app: { get: () => null } },
      res
    );
    expect(res.statusCode).toBe(201);
  });

  test('get rejects an invalid conversation id (SR-07)', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.get({ params: { id: 'xx' }, user: { id: 1, role: 'worker' } }, res);
    expect(res.statusCode).toBe(400);
  });

  test('get returns 404 when the user cannot see the conversation (SR-03)', async () => {
    const { controller } = makeController({ getConversation: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await controller.get({ params: { id: '5' }, user: { id: 1, role: 'worker' } }, res);
    expect(res.statusCode).toBe(404);
  });

  test('get returns the conversation for a participant', async () => {
    const { controller } = makeController({
      getConversation: jest.fn().mockResolvedValue({ id: 5, messages: [] }),
    });
    const res = mockRes();
    await controller.get({ params: { id: '5' }, user: { id: 1, role: 'worker' } }, res);
    expect(res.body.conversation.id).toBe(5);
  });
});
