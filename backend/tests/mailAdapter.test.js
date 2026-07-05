jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({}), verify: jest.fn() }),
}));
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
}));

const {
  SmtpMailAdapter,
  ConsoleMailAdapter,
  createMailAdapter,
} = require('../adapters/MailAdapter');

/**
 * Tests for adapters/MailAdapter.js — the mail delivery port with two adapters
 * (Strategy). createMailAdapter() must pick SMTP only when fully configured,
 * else fall back to the console adapter, so the app never crashes for missing
 * mail config and never silently claims a send that didn't happen.
 */
describe('createMailAdapter (strategy selection)', () => {
  test('returns the SMTP adapter when all SMTP_* vars are present', () => {
    const adapter = createMailAdapter({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'u@example.com',
      SMTP_PASS: 'secret',
    });
    expect(adapter).toBeInstanceOf(SmtpMailAdapter);
    expect(adapter.configured).toBe(true);
  });

  test('falls back to the console adapter when SMTP config is incomplete', () => {
    const adapter = createMailAdapter({ SMTP_HOST: 'smtp.example.com' }); // missing others
    expect(adapter).toBeInstanceOf(ConsoleMailAdapter);
    expect(adapter.configured).toBe(false);
  });

  test('falls back to the console adapter when no SMTP config is present', () => {
    expect(createMailAdapter({})).toBeInstanceOf(ConsoleMailAdapter);
  });
});

describe('ConsoleMailAdapter', () => {
  test('send returns false (signals no real delivery) and does not throw', async () => {
    const adapter = new ConsoleMailAdapter();
    await expect(
      adapter.send({ to: 'a@b.com', subject: 'Hi', link: 'https://x/verify' })
    ).resolves.toBe(false);
  });
});
