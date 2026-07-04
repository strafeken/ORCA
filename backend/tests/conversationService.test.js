// Unit tests for the conversation write-path business rules, using fake
// repositories — no database. Covers the three startConversation branches.

// The repositories transitively load the winston/loki logger via db/pool;
// mock it so the suite doesn't need a live Loki URL.
jest.mock('../utils/winstonLogger', () => ({
  system: { error: jest.fn(), info: jest.fn() },
  audit: { log: jest.fn() },
}));

const { ConversationService } = require('../services/ConversationService');

function makeService({ expert = null, existing = null, newId = 99, detail = { id: 99 } } = {}) {
  const users = {
    findAvailableExpertById: jest.fn().mockResolvedValue(expert),
  };
  const conversations = {
    findByWorkerAndExpert: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(newId),
    findDetailedForUser: jest.fn().mockResolvedValue(detail),
    listInbox: jest.fn(),
  };
  return { service: new ConversationService(conversations, users), users, conversations };
}

describe('ConversationService.startConversation', () => {
  test('returns null when the expert is not available (→ 404)', async () => {
    const { service, conversations } = makeService({ expert: null });
    await expect(service.startConversation(1, 2)).resolves.toBeNull();
    expect(conversations.create).not.toHaveBeenCalled();
  });

  test('re-opens an existing conversation (created=false, no INSERT)', async () => {
    const { service, conversations } = makeService({
      expert: { id: 2, name: 'Bob' },
      existing: { id: 7 },
      detail: { id: 7 },
    });
    const out = await service.startConversation(1, 2);
    expect(out).toEqual({ conversation: { id: 7 }, created: false });
    expect(conversations.create).not.toHaveBeenCalled();
    expect(conversations.findDetailedForUser).toHaveBeenCalledWith(7, 1);
  });

  test('creates a new conversation when none exists (created=true)', async () => {
    const { service, conversations } = makeService({
      expert: { id: 2, name: 'Bob' },
      existing: null,
      newId: 42,
      detail: { id: 42 },
    });
    const out = await service.startConversation(1, 2);
    expect(out).toEqual({ conversation: { id: 42 }, created: true });
    expect(conversations.create).toHaveBeenCalledWith(1, 2);
  });
});

describe('ConversationService.getConversation', () => {
  test('shapes the counterpart as the expert for a worker', async () => {
    const conversations = {
      findDetailedForUser: jest.fn().mockResolvedValue({
        id: 5, created_at: 'c', updated_at: 'u',
        worker_id: 1, expert_id: 2, expert_name: 'Bob', expert_bio: 'civil', worker_name: 'Wendy',
      }),
    };
    const service = new ConversationService(conversations, {});
    const out = await service.getConversation(5, 1, 'worker');
    expect(out.counterpart).toEqual({ id: 2, name: 'Bob', role: 'expert', bio: 'civil' });
  });

  test('returns null when not found / not a participant', async () => {
    const conversations = { findDetailedForUser: jest.fn().mockResolvedValue(null) };
    const service = new ConversationService(conversations, {});
    await expect(service.getConversation(5, 1, 'worker')).resolves.toBeNull();
  });
});
