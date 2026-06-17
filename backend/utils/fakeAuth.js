const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const FAKE_USERS = new Map([
  ['user-1', { id: 1, name: 'John Doe', role: 'worker' }],
  ['user-2', { id: 3, name: 'Bob Chen', role: 'expert' }],
]);

const FAKE_CONVERSATION_ID = 1;

const issueFakeToken = (userId) => {
  const user = FAKE_USERS.get(userId);
  if (!user) throw new Error('Unknown fake user');
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1d' });
};

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

const getUserById = (userId) => FAKE_USERS.get(userId) || null;

module.exports = { issueFakeToken, verifyToken, getUserById, FAKE_USERS, FAKE_CONVERSATION_ID };