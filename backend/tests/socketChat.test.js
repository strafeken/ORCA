process.env.JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

// Mock the guard + data deps that chat.js imports.
const mockAuthorize = jest.fn();
jest.mock('../sockets/guards', () => ({
  authorizeConversationEvent: (...a) => mockAuthorize(...a),
}));
const mockGetHistory = jest.fn().mockResolvedValue({ messages: [], hasMore: false });
const mockGetPage = jest.fn().mockResolvedValue({ messages: [], hasMore: false });
jest.mock('../utils/conversationRepository', () => ({
  getConversationHistory: (...a) => mockGetHistory(...a),
  getConversationPage: (...a) => mockGetPage(...a),
}));
jest.mock('../middleware/socketRateLimiter', () => ({
  createSocketLimiter: () => () => true,
}));
const mockPoolQuery = jest.fn();
jest.mock('../db/pool', () => ({
  query: mockPoolQuery,
  promise: () => ({ query: mockPoolQuery }),
}));
jest.mock('../utils/messageCipher', () => ({
  encrypt: (text) => `enc:${text}`,
}));
jest.mock('../utils/sanitize', () => ({ sanitizeText: (s) => (typeof s === 'string' ? s.trim() : s) }));
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

  test('chat:send rejects an invalid conversation id (SR-07)', async () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    await handlers.get('chat:send')({ conversationId: 'bad', content: 'hi' });
    expect(socket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      message: expect.stringMatching(/invalid conversation/i),
    }));
  });

  test('chat:send requires the socket to have joined the room first', async () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    // Valid id, but the socket never joined chat:5.
    await handlers.get('chat:send')({ conversationId: 5, content: 'hello' });
    expect(socket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      message: expect.stringMatching(/join the conversation/i),
    }));
  });

  test('chat:send silently drops an empty (whitespace-only) message', async () => {
    const io = { to: jest.fn(() => ({ emit: jest.fn() })) };
    const { socket, handlers } = makeSocket();
    socket.rooms.add('chat:5'); // has joined
    registerChatHandlers(io, socket);
    await handlers.get('chat:send')({ conversationId: 5, content: '    ' });
    // No broadcast for an empty message.
    expect(io.to).not.toHaveBeenCalled();
  });

  test('chat:send broadcasts a sanitized message when authorized', async () => {
    const emit = jest.fn();
    const io = { to: jest.fn(() => ({ emit })) };
    const { socket, handlers } = makeSocket();
    socket.user.name = 'Worker';
    socket.rooms.add('chat:5');
    registerChatHandlers(io, socket);
    mockAuthorize.mockResolvedValue(5);
    mockPoolQuery.mockResolvedValueOnce([{ insertId: 99 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);

    await handlers.get('chat:send')({ conversationId: 5, content: '  hello world  ' });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      [5, 10, 'enc:hello world']
    );
    expect(emit).toHaveBeenCalledWith('chat:message', expect.objectContaining({
      id: 99,
      content: 'hello world',
      sender_id: 10,
    }));
  });

  test('chat:load-more rejects access when authorization fails', async () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    mockAuthorize.mockResolvedValue(null);

    await handlers.get('chat:load-more')({ conversationId: 5, before: '2026-01-01T00:00:00.000Z' });

    expect(socket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      message: expect.stringMatching(/access denied/i),
    }));
  });

  test('chat:load-more returns older messages when joined and authorized', async () => {
    const { socket, handlers } = makeSocket();
    socket.rooms.add('chat:5');
    registerChatHandlers({}, socket);
    mockAuthorize.mockResolvedValue(5);
    mockGetPage.mockResolvedValueOnce({ messages: [{ id: 1 }], hasMore: true });

    await handlers.get('chat:load-more')({ conversationId: 5, before: '2026-01-01T00:00:00.000Z' });

    expect(socket.emit).toHaveBeenCalledWith('chat:older-messages', {
      messages: [{ id: 1 }],
      hasMore: true,
    });
  });

  test('chat:join emits an error when authorization throws', async () => {
    const { socket, handlers } = makeSocket();
    registerChatHandlers({}, socket);
    mockAuthorize.mockRejectedValue(new Error('db down'));

    await handlers.get('chat:join')({ conversationId: 5 });

    expect(socket.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      message: expect.stringMatching(/failed to join/i),
    }));
  });
});
