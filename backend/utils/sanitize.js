const path = require('path');

const sanitizeLog = (value) => String(value).replace(/[\r\n]/g, ' ');

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeText(value, { maxLength = 4000 } = {}) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS_RE, '').trim().slice(0, maxLength);
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