/**
 * Tests for utils/mailer.js — verifies the transactional email helper:
 *   - falls back to console logging when SMTP isn't configured (dev safety net)
 *   - when SMTP IS configured, user-controllable values are HTML-escaped before
 *     being embedded in the email body (this is the fix for the CodeQL
 *     "client-side XSS / HTML injection" alert, and supports SR-07 input
 *     sanitisation).
 *
 * We set SMTP_* env BEFORE requiring the module so the SMTP path is taken, and
 * mock nodemailer to capture the HTML that would be sent.
 */
process.env.SMTP_HOST = 'smtp.example.com';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'test@example.com';
process.env.SMTP_PASS = 'app-password';

jest.mock('nodemailer', () => {
  const mockSendMail = jest.fn().mockResolvedValue({});
  return {
    createTransport: () => ({ sendMail: mockSendMail }),
    __mockSendMail: mockSendMail,
  };
});
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
}));

const nodemailer = require('nodemailer');
const sendMailMock = nodemailer.__mockSendMail;
const { sendActionEmail, smtpConfigured } = require('../utils/mailer');

describe('mailer (SMTP configured)', () => {
  afterEach(() => jest.clearAllMocks());

  test('smtpConfigured is true when all SMTP_* are set', () => {
    expect(smtpConfigured).toBe(true);
  });

  test('sends an email and returns true on success', async () => {
    const ok = await sendActionEmail({
      to: 'user@orca.com', subject: 'Verify', heading: 'Hi',
      body: 'Welcome', link: 'https://orca.freeddns.org/verify?token=abc',
      buttonText: 'Verify',
    });
    expect(ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  test('escapes HTML in user-controllable values (XSS prevention)', async () => {
    await sendActionEmail({
      to: 'user@orca.com',
      subject: 'Verify',
      heading: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(2)>',
      link: 'https://orca.freeddns.org/verify?token=abc',
      buttonText: 'Verify',
    });
    const html = sendMailMock.mock.calls[0][0].html;
    // The raw script/img tags must NOT appear unescaped in the HTML body.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    // They should appear escaped instead.
    expect(html).toContain('&lt;script&gt;');
  });

  test('rejects a non-http(s) link (no javascript: URLs in href)', async () => {
    await sendActionEmail({
      to: 'user@orca.com', subject: 'Verify', heading: 'Hi', body: 'x',
      link: 'javascript:alert(1)', buttonText: 'Go',
    });
    const html = sendMailMock.mock.calls[0][0].html;
    // The clickable href must be neutralised to '#', not a javascript: URL.
    expect(html).toContain('href="#"');
    expect(html).not.toContain('href="javascript:');
    // Where the link is shown as text, it must be HTML-escaped (inert), so it
    // can't execute even though the characters appear.
    expect(html).not.toMatch(/<a[^>]*javascript:/i);
  });

  test('returns false and falls back when the transport throws', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));
    const ok = await sendActionEmail({
      to: 'user@orca.com', subject: 'Verify', heading: 'Hi', body: 'x',
      link: 'https://orca.freeddns.org/verify', buttonText: 'Go',
    });
    expect(ok).toBe(false); // did not throw; degraded gracefully
  });
});
