const { Server } = require('socket.io');
const { verifyToken } = require('../utils/tokens');
const { resolveSession } = require('./guards');
const { system } = require('../utils/winstonLogger');
const { registerChatHandlers } = require('./chat');
const { registerWebRTCHandlers } = require('./webrtc');

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    // No `cors` option on purpose: the app is served same-origin behind nginx
    // (see nginx/*.conf), so no cross-origin client exists. Advertising a
    // wildcard origin would let any third-party page open a socket from a
    // victim's browser.
    // Largest legitimate payload is an SDP offer (a few KB); 100 KB caps
    // memory per message against oversized frames (SR-15).
    maxHttpBufferSize: 100 * 1024,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));
    try {
      socket.user = verifyToken(token);
      // Same session checks the HTTP authMiddleware applies: a valid JWT is
      // not enough — the session must exist and not be revoked/expired
      // (SR-04). resolveSession fails closed if the DB is unreachable.
      const sessionId = await resolveSession(token);
      if (!sessionId) return next(new Error('Session revoked or expired'));
      socket.sessionId = sessionId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    system.info('Socket connected', { context: 'socket', userId: socket.user.id });
    registerChatHandlers(io, socket);
    registerWebRTCHandlers(io, socket);

    socket.on('disconnect', () => {
      system.info('Socket disconnected', { context: 'socket', userId: socket.user.id });
    });
  });

  return io;
};

module.exports = { initSocket };
