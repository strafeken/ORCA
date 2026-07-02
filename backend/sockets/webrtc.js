const { system } = require('../utils/winstonLogger');
const { authorizeConversationEvent } = require('./guards');

/**
 * WebRTC signalling relay for in-conversation video calls (FR-11).
 *
 * Confidentiality (SR-04): signalling data — SDP offers/answers, ICE
 * candidates, and live annotation strokes — is relayed only between the
 * participants of a conversation and is never persisted or written to logs.
 * SDP bodies embed private network addresses and annotations are live call
 * content; storing either would create a liability with no product need.
 * Access is enforced on EVERY event via authorizeConversationEvent (live
 * session + conversation participant), and relays additionally require the
 * sender to have entered the call room through call:join, so join is the
 * single gate into a conversation's signalling.
 *
 * Availability (SR-15): payloads are shape- and size-validated before relay,
 * and are re-serialized field by field so the relay cannot be used to push
 * arbitrary data structures to the other participant.
 */

const MAX_SDP_CHARS = 64 * 1024; // real SDP bodies are a few KB
const MAX_CANDIDATE_CHARS = 2 * 1024;
const MAX_STROKE_POINTS = 512;
const STROKE_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const isValidDescription = (desc, expectedType) =>
    !!desc && typeof desc === 'object'
    && desc.type === expectedType
    && typeof desc.sdp === 'string'
    && desc.sdp.length > 0
    && desc.sdp.length <= MAX_SDP_CHARS;

const isValidCandidate = (c) =>
    !!c && typeof c === 'object'
    && typeof c.candidate === 'string'
    && c.candidate.length <= MAX_CANDIDATE_CHARS
    && (c.sdpMid == null || typeof c.sdpMid === 'string')
    && (c.sdpMLineIndex == null || Number.isInteger(c.sdpMLineIndex))
    && (c.usernameFragment == null || typeof c.usernameFragment === 'string');

const isFiniteUnit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

const isValidStroke = (stroke) =>
    !!stroke && typeof stroke === 'object'
    && typeof stroke.color === 'string' && STROKE_COLOR_RE.test(stroke.color)
    && Array.isArray(stroke.points)
    && stroke.points.length >= 2
    && stroke.points.length <= MAX_STROKE_POINTS
    && stroke.points.every((p) => !!p && isFiniteUnit(p.x) && isFiniteUnit(p.y));

const registerWebRTCHandlers = (io, socket) => {
    const user = socket.user;

    const roomName = (conversationId) => `call:${conversationId}`;
    const inCallRoom = (conversationId) => socket.rooms.has(roomName(conversationId));

    // Join a call room for a conversation — the single entry point into a
    // conversation's signalling (FR-11: participants only).
    socket.on('call:join', async ({ conversationId: rawId } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            if (!conversationId) {
                socket.emit('call:error', { message: 'Access denied to this conversation' });
                return;
            }

            const room = roomName(conversationId);

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
    socket.on('call:offer', async ({ conversationId: rawId, offer } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            if (!conversationId || !inCallRoom(conversationId)) {
                socket.emit('call:error', { message: 'Access denied to this conversation' });
                return;
            }
            if (!isValidDescription(offer, 'offer')) {
                socket.emit('call:error', { message: 'Invalid call offer' });
                return;
            }

            const room = roomName(conversationId);
            const inRoom = await io.in(room).fetchSockets();
            const others = inRoom.filter((s) => s.user.id !== user.id);
            if (others.length === 0) {
                socket.emit('call:error', { message: 'The other participant is not in this conversation. They must be logged in and have this thread open.' });
                return;
            }

            system.info('Relaying call offer', { context: 'webrtc', userId: user.id, conversationId });
            socket.to(room).emit('call:offer', {
                offer: { type: 'offer', sdp: offer.sdp },
                fromUserId: user.id,
            });
        } catch (err) {
            system.error('call:offer error', { context: 'webrtc', error: err.message });
            socket.emit('call:error', { message: 'Failed to start call' });
        }
    });

    // Relay SDP answer
    socket.on('call:answer', async ({ conversationId: rawId, answer } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            if (!conversationId || !inCallRoom(conversationId)) {
                socket.emit('call:error', { message: 'Access denied to this conversation' });
                return;
            }
            if (!isValidDescription(answer, 'answer')) {
                socket.emit('call:error', { message: 'Invalid call answer' });
                return;
            }
            system.info('Relaying call answer', { context: 'webrtc', userId: user.id, conversationId });
            socket.to(roomName(conversationId)).emit('call:answer', {
                answer: { type: 'answer', sdp: answer.sdp },
                fromUserId: user.id,
            });
        } catch (err) {
            system.error('call:answer error', { context: 'webrtc', error: err.message });
        }
    });

    // Relay ICE candidates
    socket.on('call:ice-candidate', async ({ conversationId: rawId, candidate } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            // silently drop, no need to alert on every ICE candidate
            if (!conversationId || !inCallRoom(conversationId) || !isValidCandidate(candidate)) return;
            socket.to(roomName(conversationId)).emit('call:ice-candidate', {
                candidate: {
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdpMid ?? null,
                    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
                    usernameFragment: candidate.usernameFragment ?? null,
                },
                fromUserId: user.id,
            });
        } catch (err) {
            system.error('call:ice-candidate error', { context: 'webrtc', error: err.message });
        }
    });

    // Relay a live annotation stroke drawn over the call video (FR-11).
    // Coordinates are normalized to [0,1] so each side renders them against
    // its own video dimensions. Never persisted (SR-04).
    socket.on('call:annotation', async ({ conversationId: rawId, stroke } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            if (!conversationId || !inCallRoom(conversationId) || !isValidStroke(stroke)) return;
            socket.to(roomName(conversationId)).emit('call:annotation', {
                stroke: {
                    color: stroke.color,
                    points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
                },
                fromUserId: user.id,
            });
        } catch (err) {
            system.error('call:annotation error', { context: 'webrtc', error: err.message });
        }
    });

    // Clear all annotations for both participants
    socket.on('call:annotation-clear', async ({ conversationId: rawId } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            if (!conversationId || !inCallRoom(conversationId)) return;
            socket.to(roomName(conversationId)).emit('call:annotation-clear', { fromUserId: user.id });
        } catch (err) {
            system.error('call:annotation-clear error', { context: 'webrtc', error: err.message });
        }
    });

    // Explicit hang-up: tell the other side to tear down call media now
    // instead of waiting for ICE to time out. The socket stays in the room so
    // presence and a follow-up call keep working; text chat is unaffected
    // (SR-15).
    socket.on('call:end', async ({ conversationId: rawId } = {}) => {
        try {
            const conversationId = await authorizeConversationEvent(socket, rawId);
            if (!conversationId || !inCallRoom(conversationId)) return;
            socket.to(roomName(conversationId)).emit('call:ended', { fromUserId: user.id });
            system.info('Call ended by participant', { context: 'webrtc', userId: user.id, conversationId });
        } catch (err) {
            system.error('call:end error', { context: 'webrtc', error: err.message });
        }
    });

    // Leave the call room (thread closed/unmounted). No DB check needed:
    // leaving is only meaningful for rooms this socket actually joined.
    socket.on('call:leave', ({ conversationId: rawId } = {}) => {
        const conversationId = Number(rawId);
        if (!Number.isInteger(conversationId) || !inCallRoom(conversationId)) return;
        const room = roomName(conversationId);
        socket.to(room).emit('call:user-left', { userId: user.id });
        socket.leave(room);
        socket.currentCallId = null;
        system.info('User left call room', { context: 'webrtc', userId: user.id, conversationId });
    });

    // Clean up if they disconnect mid-call
    socket.on('disconnect', () => {
        if (socket.currentCallId) {
            socket.to(roomName(socket.currentCallId)).emit('call:user-left', { userId: user.id });
        }
    });
};

module.exports = { registerWebRTCHandlers };
