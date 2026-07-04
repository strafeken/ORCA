const nodemailer = require('nodemailer');
const { system } = require('../utils/winstonLogger');

/**
 * MailAdapter — Ports & Adapters (with a dash of Strategy).
 *
 * The port is "deliver a prepared message". Two adapters implement it:
 *   - SmtpMailAdapter:    real send via nodemailer.
 *   - ConsoleMailAdapter: dev/test fallback that logs the message + link.
 *
 * createMailAdapter() selects one from the environment, so callers (mailer.js)
 * never branch on SMTP configuration — they just call adapter.send().
 */

class ConsoleMailAdapter {
  get configured() {
    return false;
  }

  // Never logs secrets — only recipient, subject, and the single-use link.
  async send({ to, subject, link }) {
    system.info('DEV EMAIL (not sent — SMTP unconfigured or failed)', {
      context: 'mailer', to, subject, link,
    });
    /* eslint-disable no-console */
    console.log('\n========== DEV EMAIL ==========');
    console.log('To:      ', to);
    console.log('Subject: ', subject);
    console.log('Link:    ', link);
    console.log('===============================\n');
    /* eslint-enable no-console */
    return false;
  }
}

class SmtpMailAdapter {
  constructor({ host, port, user, pass, from }) {
    this.from = from || user;
    this.fallback = new ConsoleMailAdapter();
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user, pass },
    });
  }

  get configured() {
    return true;
  }

  async send({ to, subject, text, html, link }) {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text, html });
      system.info('Email sent', { context: 'mailer', to, subject });
      return true;
    } catch (err) {
      // Don't let a mail failure break the request — log the link as a fallback.
      system.error('Email send failed, falling back to log', {
        context: 'mailer', to, error: err.message,
      });
      return this.fallback.send({ to, subject, link });
    }
  }
}

function createMailAdapter(env = process.env) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return new SmtpMailAdapter({
      host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS, from: MAIL_FROM,
    });
  }
  return new ConsoleMailAdapter();
}

module.exports = { SmtpMailAdapter, ConsoleMailAdapter, createMailAdapter };
