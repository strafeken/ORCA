const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const http = require('node:http');
const app = require('./app');
const { initSocket } = require('./sockets/index');
const { system } = require('./utils/winstonLogger');

const server = http.createServer(app);
const io = initSocket(server);

app.set('io', io);

server.listen(3000, () => {
  system.info('Server running on port 3000', { context: 'server' });
});