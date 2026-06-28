const { Server } = require('socket.io');
const { verifyToken } = require('../utils/tokens');
const { system } = require('../utils/winstonLogger');
const { registerChatHandlers } = require('./chat');
const { registerWebRTCHandlers } = require('./webrtc');

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));
    try {
      socket.user = verifyToken(token);
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