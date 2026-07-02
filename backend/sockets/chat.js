const pool = require('../db/pool');
const { system } = require('../utils/winstonLogger');
const { sanitizeText } = require('../utils/sanitize');
const { getConversationHistory, getConversationPage } = require('../utils/conversationRepository');
const { createSocketLimiter } = require('../middleware/socketRateLimiter');
const { authorizeConversationEvent } = require('./guards');

const sendLimiter = createSocketLimiter({ windowMs: 10_000, max: 20 }); // 20 messages per 10 seconds

const MAX_MESSAGE_LENGTH = 4000;

const registerChatHandlers = (io, socket) => {
  const user = socket.user;

  /**
   * Room-membership guard: cheap, in-memory check that this socket has
   * already joined the room for this conversation. This is NOT the
   * authoritative access-control decision (that's always the DB check via
   * authorizeConversationEvent -- membership in `conversations`, plus a live,
   * non-revoked session, can only be confirmed against the database), but it
   * lets us reject a mismatched/forged conversationId on `chat:send` without a
   * DB round trip, and it stops a socket from writing into a room it never
   * properly joined, even if it happens to know a valid conversationId.
   */
  function hasJoinedRoom(conversationId) {
    return socket.rooms.has(`chat:${conversationId}`);
  }

  // ---- Join a conversation ----
  socket.on('chat:join', async ({ conversationId: rawId } = {}) => {
    try {
      // Authoritative gate: id parse + live-session + participant (SR-04).
      // Same guard the call events use, so chat and call share one door.
      const id = await authorizeConversationEvent(socket, rawId);
      if (!id) {
        socket.emit('chat:error', { message: 'Access denied to this conversation' });
        return;
      }

      socket.join(`chat:${id}`);
      socket.currentConversationId = id;
      system.info('User joined chat room', { context: 'chat', userId: user.id, conversationId: id });

      const { messages, hasMore } = await getConversationHistory(id, 50);
      socket.emit('chat:history', { messages, hasMore });
    } catch (err) {
      system.error('chat:join error', { context: 'chat', error: err.message });
      socket.emit('chat:error', { message: 'Failed to join conversation' });
    }
  });

  // ---- Leave a conversation (mirrors call:leave in sockets/webrtc.js) ----
  socket.on('chat:leave', ({ conversationId }) => {
    const id = Number.parseInt(conversationId, 10);
    if (!Number.isInteger(id)) return;
    socket.leave(`chat:${id}`);
    if (socket.currentConversationId === id) {
      socket.currentConversationId = null;
    }
  });

  // ---- Load older messages (pagination) ----
  socket.on('chat:load-more', async ({ conversationId: rawId, before } = {}) => {
    try {
      // Authoritative gate (SR-04) — participant status could have changed.
      const id = await authorizeConversationEvent(socket, rawId);
      if (!id) {
        socket.emit('chat:error', { message: 'Access denied to this conversation' });
        return;
      }

      // Must already be in the room before paginating.
      if (!hasJoinedRoom(id)) {
        socket.emit('chat:error', { message: 'Join the conversation before loading messages.' });
        return;
      }

      // Validate the `before` timestamp — must be a parseable date string.
      if (!before || Number.isNaN(Date.parse(before))) {
        socket.emit('chat:error', { message: 'Invalid pagination cursor.' });
        return;
      }

      const { messages, hasMore } = await getConversationPage(id, before, 50);
      socket.emit('chat:older-messages', { messages, hasMore });
    } catch (err) {
      system.error('chat:load-more error', { context: 'chat', error: err.message });
      socket.emit('chat:error', { message: 'Failed to load older messages' });
    }
  });

  // ---- Send a text message ----
  socket.on('chat:send', async ({ conversationId: rawId, content } = {}) => {
    try {
      const id = Number.parseInt(rawId, 10);
      if (!Number.isInteger(id) || id < 1) {
        socket.emit('chat:error', { message: 'Invalid conversation.' });
        return;
      }

      // Fast-path guard (see hasJoinedRoom above) before doing any DB work.
      if (!hasJoinedRoom(id)) {
        socket.emit('chat:error', { message: 'Join the conversation before sending messages.' });
        return;
      }

      // SR-07 -- sanitise/validate server-side before anything else.
      const clean = sanitizeText(content, { maxLength: MAX_MESSAGE_LENGTH });
      if (!clean) return; // empty after trimming/stripping -- silently drop

      // SR-13 (socket layer) -- throttle per authenticated user, not per
      // socket, so reconnecting doesn't reset the budget.
      if (!sendLimiter(user.id)) {
        socket.emit('chat:error', { message: 'You are sending messages too quickly. Please slow down.' });
        return;
      }

      // Authoritative re-check (SR-04): live session + participant, verified
      // against the DB on every write, not just on join. The room-membership
      // fast path above only proves this socket joined at some point.
      const authedId = await authorizeConversationEvent(socket, id);
      if (!authedId) {
        socket.emit('chat:error', { message: 'Access denied to this conversation' });
        return;
      }

      const [result] = await pool.promise().query(
        'INSERT INTO messages (conversation_id, sender_id, content, sent_at) VALUES (?, ?, ?, NOW())',
        [id, user.id, clean]
      );

      await pool.promise().query(
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [id]
      );

      const message = {
        type: 'text',
        id: result.insertId,
        ts: new Date().toISOString(),
        sender_id: user.id,
        sender_name: user.name,
        content: clean,
      };

      // Broadcast to everyone in the room, including the sender, so every
      // connected tab renders from the same server-confirmed event rather
      // than an optimistic local echo.
      io.to(`chat:${id}`).emit('chat:message', message);
      system.info('Message sent', { context: 'chat', userId: user.id, conversationId: id });
    } catch (err) {
      system.error('chat:send error', { context: 'chat', error: err.message });
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });

  // ---- Cleanup on disconnect ----
  socket.on('disconnect', () => {
    // Socket.IO leaves all rooms automatically on disconnect; this just
    // clears our own bookkeeping so a stale currentConversationId can't
    // linger if the socket object is somehow reused.
    socket.currentConversationId = null;
  });
};

module.exports = { registerChatHandlers };
