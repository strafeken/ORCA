// Jest setupFiles — runs once per test suite before any module is required.
//
// messageCipher (used by the chat socket, ConversationRepository and the admin
// chat-log route) needs MESSAGE_ENC_KEY. Provide a throwaway key for tests that
// don't set their own, so encrypt/decrypt work end-to-end. Idempotent: a value
// supplied by the environment or an individual test file is respected.
const { randomBytes } = require('node:crypto');

process.env.MESSAGE_ENC_KEY = process.env.MESSAGE_ENC_KEY || randomBytes(32).toString('hex');
