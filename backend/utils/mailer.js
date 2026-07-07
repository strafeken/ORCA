const { createMailAdapter } = require('../adapters/MailAdapter');

/**
 * Mailer — builds transactional email (verification, password reset) and hands
 * delivery to a MailAdapter (see adapters/MailAdapter.js): real SMTP when
 * SMTP_* is configured, a console fallback otherwise, so development/testing is
 * never blocked by missing mail credentials. This module owns the *content*
 * (HTML building + escaping); the adapter owns *delivery*.
 *
 * .env keys (all optional — absence triggers the console fallback):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 */
const mailAdapter = createMailAdapter();
const smtpConfigured = mailAdapter.configured;

/**
 * Escape HTML special characters so user-controlled values (name, etc.) can't
 * inject markup or script into the email body. Applied to every interpolated
 * value below.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
  if (!mailAdapter.configured) {
    return mailAdapter.send({ to, subject, link });
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

  return mailAdapter.send({
    to,
    subject,
    text: `${body}\n\n${link}`,
    html,
    link,
  });
}

module.exports = { sendActionEmail, smtpConfigured };
