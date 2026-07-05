// This repository calls pool.promise().query(...) on each call, so the mock's
// promise() must return an object with a query() we can assert on.
const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({ promise: () => ({ query: mockQuery }) }));

const { ConversationRepository } = require('../repositories/ConversationRepository');

/**
 * Tests for repositories/ConversationRepository.js — conversation data access.
 *
 * The security-critical part is participant scoping: SR-03 requires that only
 * conversation participants (and Admins) can read a conversation. getForParticipant
 * / isParticipant are the gate the socket and REST layers rely on, so these tests
 * assert the WHERE clause always constrains by worker_id/expert_id = the user.
 * Also covers history bounds (defensive limit) and conversation creation (FR-07).
 */
describe('ConversationRepository participant scoping (SR-03)', () => {
  const repo = new ConversationRepository();
  afterEach(() => jest.clearAllMocks());

  test('getForParticipant scopes the query to the requesting user', async () => {
    mockQuery.mockResolvedValue([[{ id: 1, worker_id: 10, expert_id: 20 }]]);
    const row = await repo.getForParticipant(1, 10);
    expect(row.id).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    // Must constrain by the user being a participant.
    expect(sql).toMatch(/worker_id = \? OR expert_id = \?/i);
    expect(params).toEqual([1, 10, 10]);
  });

  test('getForParticipant returns null when the user is not a participant', async () => {
    mockQuery.mockResolvedValue([[]]);
    expect(await repo.getForParticipant(1, 999)).toBeNull();
  });

  test('isParticipant is true only when a scoped row is found', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1, worker_id: 10, expert_id: 20 }]]);
    expect(await repo.isParticipant(1, 10)).toBe(true);
    mockQuery.mockResolvedValueOnce([[]]);
    expect(await repo.isParticipant(1, 999)).toBe(false);
  });
});

describe('ConversationRepository history + creation (FR-07)', () => {
  const repo = new ConversationRepository();
  afterEach(() => jest.clearAllMocks());

  test('getHistory clamps an out-of-range limit to a safe default', async () => {
    mockQuery.mockResolvedValue([[]]);
    await repo.getHistory(1, 99999); // absurd limit
    const [, params] = mockQuery.mock.calls[0];
    // The bounded limit (50) should appear in the params, not 99999.
    expect(params).not.toContain(99999);
  });

  test('getHistory accepts a valid in-range limit', async () => {
    mockQuery.mockResolvedValue([[]]);
    await repo.getHistory(1, 25);
    expect(mockQuery).toHaveBeenCalled();
  });

  test('findByWorkerAndExpert looks up an existing pairing', async () => {
    mockQuery.mockResolvedValue([[{ id: 7 }]]);
    const row = await repo.findByWorkerAndExpert(10, 20);
    expect(row.id).toBe(7);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/worker_id = \? AND expert_id = \?/i);
    expect(params).toEqual([10, 20]);
  });

  test('create inserts a new conversation and returns its id', async () => {
    mockQuery.mockResolvedValue([{ insertId: 55 }]);
    const id = await repo.create(10, 20);
    expect(id).toBe(55);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO conversations/i);
    expect(params).toEqual([10, 20]);
  });
});
