const pool = require('../db/pool');
const { system } = require('../utils/winstonLogger');
const { authorizeConversationEvent } = require('./guards');

// Generous for a chat message, but bounds what one socket event can write to
// the DB and what chat:history later replays to every joiner (SR-15).
const MAX_MESSAGE_CHARS = 4000;

const registerChatHandlers = (io, socket) => {
  const user = socket.user;

  // Join a conversation room
  socket.on('chat:join', async ({ conversationId: rawId } = {}) => {
    try {
      // Live session + participant check (SR-04) — same gate as call events
      const conversationId = await authorizeConversationEvent(socket, rawId);
      if (!conversationId) {
        socket.emit('chat:error', { message: 'Access denied to this conversation' });
        return;
      }

      socket.join(`chat:${conversationId}`);
      socket.currentConversationId = conversationId;
      system.info('User joined chat room', { context: 'chat', userId: user.id, conversationId });

      // Send last 50 messages as history
      const [messages] = await pool.promise().query(
        `SELECT m.id, m.content, m.sent_at, m.sender_id, u.name AS sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ?
         ORDER BY m.sent_at DESC
         LIMIT 50`,
        [conversationId]
      );
      socket.emit('chat:history', { messages: messages.reverse() });
    } catch (err) {
      system.error('chat:join error', { context: 'chat', error: err.message });
      socket.emit('chat:error', { message: 'Failed to join conversation' });
    }
  });

  // Send a message
  socket.on('chat:send', async ({ conversationId: rawId, content } = {}) => {
    try {
      if (typeof content !== 'string' || !content.trim()) return;
      if (content.length > MAX_MESSAGE_CHARS) {
        socket.emit('chat:error', { message: 'Message is too long.' });
        return;
      }

      // Live session + participant check (SR-04)
      const conversationId = await authorizeConversationEvent(socket, rawId);
      if (!conversationId) {
        socket.emit('chat:error', { message: 'Access denied to this conversation' });
        return;
      }

      // Save to DB
      const [result] = await pool.promise().query(
        'INSERT INTO messages (conversation_id, sender_id, content, sent_at) VALUES (?, ?, ?, NOW())',
        [conversationId, user.id, content.trim()]
      );

      await pool.promise().query(
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId]
      );

      const message = {
        id: result.insertId,
        conversation_id: conversationId,
        sender_id: user.id,
        sender_name: user.name,
        content: content.trim(),
        sent_at: new Date().toISOString(),
      };

      // Broadcast to everyone in the room including sender
      io.to(`chat:${conversationId}`).emit('chat:message', message);
      system.info('Message sent', { context: 'chat', userId: user.id, conversationId });
    } catch (err) {
      system.error('chat:send error', { context: 'chat', error: err.message });
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });
};

module.exports = { registerChatHandlers };