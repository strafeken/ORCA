process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.CSRF_SECRET = process.env.CSRF_SECRET || 'test-csrf-secret';

jest.mock('../../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  audit: { log: jest.fn() },
  httpLogger: (req, res, next) => next(),
}));

const { passwordPolicyMiddleware, commonPasswords } = require('../../middleware/passwordCheck');
const { system } = require('../../utils/winstonLogger');

function mockReqRes(body = {}, user) {
  const req = { body, user };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('passwordPolicyMiddleware (NIST SP 800-63B blocklist)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('rejects passwords shorter than 8 characters', async () => {
    const { req, res, next } = mockReqRes({ password: 'short' });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects passwords longer than 128 characters (Argon2id DoS guard)', async () => {
    const { req, res, next } = mockReqRes({ password: 'a'.repeat(129) });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects context-specific banned words from the request body', async () => {
    const { req, res, next } = mockReqRes({
      password: 'myorcaSecret1',
      name: 'Jane',
      email: 'jane@orca.com',
    });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/application terms/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects email local-part matches', async () => {
    const { req, res, next } = mockReqRes({
      password: 'janedoe2024!',
      email: 'janedoe@example.com',
    });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects exact matches from the common-password blocklist', async () => {
    expect(commonPasswords.has('123456789')).toBe(true);
    const { req, res, next } = mockReqRes({ password: '123456789' });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/too common/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects passwords found in the HIBP range response', async () => {
    const password = 'ValidPass1234!';
    const { suffix } = require('../../utils/hibpRangeDigest').hibpRangeDigest(password);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `${suffix}:999\n`,
    });

    const { req, res, next } = mockReqRes({ password });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/data breach/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('fails open when the HIBP API errors', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const { req, res, next } = mockReqRes({
      password: 'UniqueSafePass99!',
      name: 'Jane',
      email: 'jane@example.com',
    });
    await passwordPolicyMiddleware(req, res, next);
    expect(system.warn).toHaveBeenCalledWith(
      expect.stringContaining('HIBP'),
      expect.objectContaining({ context: 'passwordCheck' })
    );
    expect(next).toHaveBeenCalled();
  });

  test('calls next when all checks pass', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });

    const { req, res, next } = mockReqRes({
      newPassword: 'UniqueSafePass99!',
      name: 'Jane',
      email: 'jane@example.com',
    });
    await passwordPolicyMiddleware(req, res, next);
    expect(res.statusCode).toBe(200);
    expect(next).toHaveBeenCalled();
  });
});
