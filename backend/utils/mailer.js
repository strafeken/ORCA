const nodemailer = require('nodemailer');
const { system } = require('./winstonLogger');

/**
 * Mailer — sends transactional email (verification, password reset).
 *
 * Real SMTP when configured, console fallback when not. This means:
 *   - With SMTP_* set in .env  -> a real email is sent (production behaviour).
 *   - Without them             -> the message + link is logged to the server
 *                                 console, so development/testing is never
 *                                 blocked by missing mail credentials.
 *
 * The fallback also catches the case where SMTP is configured but sending
 * fails (network, bad credentials): rather than crash a registration, we log
 * the link so the flow can still be completed/tested, and record the error.
 *
 * .env keys (all optional — absence triggers the console fallback):
 *   SMTP_HOST   e.g. smtp.gmail.com
 *   SMTP_PORT   e.g. 587
 *   SMTP_USER   the sending account, e.g. you@gmail.com
 *   SMTP_PASS   Gmail APP PASSWORD (not the account password)
 *   MAIL_FROM   optional display From, defaults to SMTP_USER
 */

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
} = process.env;

const smtpConfigured = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);

let transporter = null;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * Log an email to the console instead of sending it. Used when SMTP isn't
 * configured or a real send fails. Never logs secrets — only the recipient,
 * subject, and the action link (which is single-use and short-lived anyway).
 */
function logFallback(to, subject, link) {
  system.info('DEV EMAIL (not sent — SMTP unconfigured or failed)', {
    context: 'mailer', to, subject, link,
  });
  // Also print plainly so it's easy to copy from `docker compose logs backend`.
  /* eslint-disable no-console */
  console.log('\n========== DEV EMAIL ==========');
  console.log('To:      ', to);
  console.log('Subject: ', subject);
  console.log('Link:    ', link);
  console.log('===============================\n');
  /* eslint-enable no-console */
}

/**
 * Escape HTML special characters so user-controlled values (name, etc.) can't
 * inject markup or script into the email body. Applied to every interpolated
 * value below.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Encode a URL for safe use in an href attribute. encodeURI keeps the URL
 * functional while neutralising characters that could break out of the
 * attribute context.
 */
function safeUrl(url) {
  // Only allow http(s) links; anything else becomes an empty (harmless) href.
  const s = String(url);
  if (!/^https?:\/\//i.test(s)) return '#';
  return encodeURI(s);
}

/**
 * Send an email containing an action link. Returns true if a real email was
 * sent, false if it fell back to logging. Callers don't need to branch on this
 * — the verification/reset flow is identical either way.
 */
async function sendActionEmail({ to, subject, heading, body, link, buttonText }) {
  if (!smtpConfigured) {
    logFallback(to, subject, link);
    return false;
  }

  // Escape all user-controllable values before embedding them in HTML.
  const safeHeading = escapeHtml(heading);
  const safeBody = escapeHtml(body);
  const safeButton = escapeHtml(buttonText);
  const hrefLink = safeUrl(link);
  const textLink = escapeHtml(link);

  const html = `
    <div style="font-family: system-ui, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#0f1722;">${safeHeading}</h2>
      <p style="color:#333; line-height:1.5;">${safeBody}</p>
      <p style="margin:28px 0;">
        <a href="${hrefLink}"
           style="background:#ffb323; color:#0a0e14; padding:12px 22px;
                  border-radius:8px; text-decoration:none; font-weight:600;">
          ${safeButton}
        </a>
      </p>
      <p style="color:#888; font-size:13px;">
        If the button doesn't work, paste this link into your browser:<br>${textLink}
      </p>
      <p style="color:#aaa; font-size:12px;">If you didn't request this, you can ignore this email.</p>
    </div>`;

  try {
    await transporter.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to,
      subject,
      text: `${body}\n\n${link}`,
      html,
    });
    system.info('Email sent', { context: 'mailer', to, subject });
    return true;
  } catch (err) {
    // Don't let a mail failure break the request — log the link as a fallback.
    system.error('Email send failed, falling back to log', {
      context: 'mailer', to, error: err.message,
    });
    logFallback(to, subject, link);
    return false;
  }
}

module.exports = { sendActionEmail, smtpConfigured };
