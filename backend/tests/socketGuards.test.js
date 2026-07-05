process.env.JWT_SECRET = 'test-secret-for-jest-only-1234567890';

// Mock the repositories the guards module instantiates at load time.
const mockFindLiveByTokenHash = jest.fn();
const mockIsLiveById = jest.fn();
const mockIsParticipant = jest.fn();
jest.mock('../repositories/SessionRepository', () => ({
  SessionRepository: jest.fn().mockImplementation(() => ({
    findLiveByTokenHash: mockFindLiveByTokenHash,
    isLiveById: mockIsLiveById,
  })),
}));
jest.mock('../repositories/ConversationRepository', () => ({
  ConversationRepository: jest.fn().mockImplementation(() => ({
    isParticipant: mockIsParticipant,
  })),
}));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
}));

const {
  parseConversationId,
  isSessionLive,
  authorizeConversationEvent,
} = require('../sockets/guards');

/**
 * Tests for sockets/guards.js — per-event access control for the realtime layer.
 *
 * Covers SR-07 (strict server-side validation of the client-supplied
 * conversation id, preventing objects/arrays/injection reaching a query) and
 * SR-03/SR-04 (only a participant on a live session may act on a conversation).
 */
describe('parseConversationId (SR-07 input validation)', () => {
  test('accepts a positive integer', () => {
    expect(parseConversationId(5)).toBe(5);
  });

  test('accepts a digit-only string and coerces to number', () => {
    expect(parseConversationId('42')).toBe(42);
  });

  test('rejects zero and negatives', () => {
    expect(parseConversationId(0)).toBeNull();
    expect(parseConversationId(-3)).toBeNull();
  });

  test('rejects non-numeric strings', () => {
    expect(parseConversationId('12; DROP TABLE')).toBeNull();
    expect(parseConversationId('abc')).toBeNull();
  });

  test('rejects objects and arrays (no NoSQL/param injection)', () => {
    expect(parseConversationId({})).toBeNull();
    expect(parseConversationId([1])).toBeNull();
    expect(parseConversationId(null)).toBeNull();
    expect(parseConversationId(undefined)).toBeNull();
  });

  test('rejects an over-long digit string (bounded length)', () => {
    expect(parseConversationId('1'.repeat(20))).toBeNull();
  });
});

describe('isSessionLive (SR-18 live-session check)', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns false for a missing session id', async () => {
    expect(await isSessionLive(null)).toBe(false);
  });

  test('delegates to the repository for a real id', async () => {
    mockIsLiveById.mockResolvedValue(true);
    expect(await isSessionLive(9)).toBe(true);
    expect(mockIsLiveById).toHaveBeenCalledWith(9);
  });
});

describe('authorizeConversationEvent (SR-03/SR-04 participant gate)', () => {
  afterEach(() => jest.clearAllMocks());

  const socket = { sessionId: 9, user: { id: 10 } };

  test('denies when the conversation id is invalid', async () => {
    expect(await authorizeConversationEvent(socket, 'bad')).toBeNull();
    // Should short-circuit before hitting the DB.
    expect(mockIsLiveById).not.toHaveBeenCalled();
  });

  test('denies when the session is no longer live', async () => {
    mockIsLiveById.mockResolvedValue(false);
    expect(await authorizeConversationEvent(socket, 5)).toBeNull();
  });

  test('denies when the user is not a participant (SR-03)', async () => {
    mockIsLiveById.mockResolvedValue(true);
    mockIsParticipant.mockResolvedValue(false);
    expect(await authorizeConversationEvent(socket, 5)).toBeNull();
  });

  test('allows and returns the id for a live session participant', async () => {
    mockIsLiveById.mockResolvedValue(true);
    mockIsParticipant.mockResolvedValue(true);
    expect(await authorizeConversationEvent(socket, 5)).toBe(5);
    expect(mockIsParticipant).toHaveBeenCalledWith(5, 10);
  });
});
