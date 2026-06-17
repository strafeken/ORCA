const pool = require('../db/pool');
const { system } = require('../utils/winstonLogger');

const registerWebRTCHandlers = (io, socket) => {
    const user = socket.user;

    const isParticipant = async (conversationId, userId) => {
        const [rows] = await pool.promise().query(
            'SELECT id FROM conversations WHERE id = ? AND (worker_id = ? OR expert_id = ?)',
            [conversationId, userId, userId]
        );
        return rows.length > 0;
    };

    // Join a call room for a conversation
    socket.on('call:join', async ({ conversationId }) => {
        try {
            const allowed = await isParticipant(conversationId, user.id);
            if (!allowed) {
                socket.emit('call:error', { message: 'Access denied to this conversation' });
                return;
            }

            const room = `call:${conversationId}`;

            // Get sockets already in the room BEFORE we join, so we can tell the new joiner about them
            const existingSockets = await io.in(room).fetchSockets();

            socket.join(room);
            socket.currentCallId = conversationId;

            // Tell the new joiner about everyone already present in the room
            existingSockets.forEach((existingSocket) => {
                socket.emit('call:user-joined', { userId: existingSocket.user.id, name: existingSocket.user.name });
            });

            // Tell everyone already present about the new joiner
            socket.to(room).emit('call:user-joined', { userId: user.id, name: user.name });

            system.info('User joined call room', { context: 'webrtc', userId: user.id, conversationId, existingCount: existingSockets.length });
        } catch (err) {
            system.error('call:join error', { context: 'webrtc', error: err.message });
            socket.emit('call:error', { message: 'Failed to join call' });
        }
    });

    // Relay SDP offer to the other participant
    socket.on('call:offer', async ({ conversationId, offer }) => {
        const allowed = await isParticipant(conversationId, user.id);
        if (!allowed) {
            socket.emit('call:error', { message: 'Access denied to this conversation' });
            return;
        }
        system.info('Relaying call offer', { context: 'webrtc', userId: user.id, conversationId });
        socket.to(`call:${conversationId}`).emit('call:offer', { offer, fromUserId: user.id });
    });

    // Relay SDP answer
    socket.on('call:answer', async ({ conversationId, answer }) => {
        const allowed = await isParticipant(conversationId, user.id);
        if (!allowed) {
            socket.emit('call:error', { message: 'Access denied to this conversation' });
            return;
        }
        system.info('Relaying call answer', { context: 'webrtc', userId: user.id, conversationId });
        socket.to(`call:${conversationId}`).emit('call:answer', { answer, fromUserId: user.id });
    });

    // Relay ICE candidates
    socket.on('call:ice-candidate', async ({ conversationId, candidate }) => {
        const allowed = await isParticipant(conversationId, user.id);
        if (!allowed) return; // silently drop, no need to alert on every ICE candidate
        socket.to(`call:${conversationId}`).emit('call:ice-candidate', { candidate, fromUserId: user.id });
    });

    // Leave the call
    socket.on('call:leave', ({ conversationId }) => {
        const room = `call:${conversationId}`;
        socket.to(room).emit('call:user-left', { userId: user.id });
        socket.leave(room);
        socket.currentCallId = null;
        system.info('User left call room', { context: 'webrtc', userId: user.id, conversationId });
    });

    // Clean up if they disconnect mid-call
    socket.on('disconnect', () => {
        if (socket.currentCallId) {
            socket.to(`call:${socket.currentCallId}`).emit('call:user-left', { userId: user.id });
        }
    });
};

module.exports = { registerWebRTCHandlers };