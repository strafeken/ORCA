const path = require('node:path');

const sanitizeLog = (value) => String(value).replace(/[\r\n]/g, ' ');

// Control-character codes stripped from user input so they can't smuggle
// terminal escapes or corrupt stored text: C0 controls except tab (0x09),
// newline (0x0A) and carriage return (0x0D), plus DEL (0x7F). Checked by code
// point rather than a regex literal, which keeps raw control characters out of
// the source and avoids the no-control-regex lint / code-scanning finding.
function isStrippableControlChar(code) {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
}

function sanitizeText(value, { maxLength = 4000 } = {}) {
  if (typeof value !== 'string') return '';
  let cleaned = '';
  for (const ch of value) {
    if (!isStrippableControlChar(ch.codePointAt(0))) cleaned += ch;
  }
  return cleaned.trim().slice(0, maxLength);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** (SR-07, mitigates T-27). */
const SAFE_FILENAME_RE = /[^a-zA-Z0-9._-]/g;

function sanitizeFilename(name, { maxLength = 180 } = {}) {
  if (typeof name !== 'string' || !name.trim()) return 'file';
  const base = path.basename(name.trim()); // drops any path separators
  const cleaned = base.replace(SAFE_FILENAME_RE, '_').replace(/^\.+/, '');
  return (cleaned || 'file').slice(0, maxLength);
}

module.exports = { sanitizeLog, sanitizeText, escapeHtml, sanitizeFilename };
