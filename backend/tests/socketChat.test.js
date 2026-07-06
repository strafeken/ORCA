process.env.JWT_SECRET = 'test-secret-for-jest-only-1234567890';

// Mock the guard + data deps that chat.js imports.
const mockAuthorize = jest.fn();
jest.mock('../sockets/guards', () => ({
  authorizeConversationEvent: (...a) => mockAuthorize(...a),
}));
const mockGetHistory = jest.fn().mockResolvedValue({ messages: [], hasMore: false });
jest.mock('../utils/conversationRepository', () => ({
  getConversationHistory: (...a) => mockGetHistory(...a),
  getConversationPage: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
}));
jest.mock('../middleware/socketRateLimiter', () => ({
  createSocketLimiter: () => () => true, // never rate-limited in these tests
}));
jest.mock('../db/pool', () => ({ query: jest.fn(), promise: () => ({ query: jest.fn() }) }));
jest.mock('../utils/sanitize', () => ({ sanitizeText: (s) => s }));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
}));

const { registerChatHandlers } = require('../sockets/chat');

/**
 * Tests for sockets/chat.js — realtime chat event handlers.
 *
 * These register the handlers against a fake socket, capture the callbacks, and
 * invoke them directly. The key security property is that chat:join is gated by
 * authorizeConversationEvent (SR-03 participant-only, SR-04 live session): a
 * denied authorization must emit an error and NOT join the room.
 */
function makeSocket() {
  const handlers = new Map();
  const socket = {
    user: { id: 10, role: 'worker' },
    rooms: new Set(),
    currentConversationId: null,
    emit: jest.fn(),
    join: jest.fn(function (room) { this.rooms.add(room); }),
    leave: jest.fn(function (room) { this.rooms.delete(room); }),
    on: (event, cb) => { handlers.set(event, cb); },
  };
  return { socket, handlers };
}

describe('registerChatHandlers', () => {
  afterEach(() => jest.clearAllMocks());

  test('registers the expected chat events', () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    expect(typeof handlers.get('chat:join')).toBe('function');
    expect(typeof handlers.get('chat:send')).toBe('function');
    expect(typeof handlers.get('chat:leave')).toBe('function');
  });

  test('chat:join is denied when authorization fails (SR-03/SR-04)', async () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    mockAuthorize.mockResolvedValue(null); // not a participant / no live session

    await handlers.get('chat:join')({ conversationId: 5 });

    expect(socket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      message: expect.stringMatching(/access denied/i),
    }));
    expect(socket.join).not.toHaveBeenCalled();
  });

  test('chat:join joins the room and sends history when authorized', async () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    mockAuthorize.mockResolvedValue(5); // authorized -> conversation id 5

    await handlers.get('chat:join')({ conversationId: 5 });

    expect(socket.join).toHaveBeenCalledWith('chat:5');
    expect(socket.emit).toHaveBeenCalledWith('chat:history', expect.any(Object));
  });

  test('chat:leave leaves the room for a valid id', () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    socket.rooms.add('chat:5');
    socket.currentConversationId = 5;

    handlers.get('chat:leave')({ conversationId: 5 });

    expect(socket.leave).toHaveBeenCalledWith('chat:5');
    expect(socket.currentConversationId).toBeNull();
  });

  test('chat:leave ignores an invalid id', () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    handlers.get('chat:leave')({ conversationId: 'notanumber' });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});
