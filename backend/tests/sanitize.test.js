const {
  sanitizeLog,
  sanitizeText,
  escapeHtml,
  sanitizeFilename,
} = require('../utils/sanitize');

/**
 * Tests for utils/sanitize.js — server-side input sanitisation (SR-07).
 * Covers log-injection defence, control-character stripping, HTML escaping
 * (XSS defence, T-23), and filename sanitisation (path-traversal defence, T-27).
 */
describe('sanitizeLog', () => {
  test('replaces newlines and carriage returns to prevent log injection', () => {
    expect(sanitizeLog('line1\nline2\rline3')).toBe('line1 line2 line3');
  });

  test('coerces non-strings to a string', () => {
    expect(sanitizeLog(123)).toBe('123');
  });
});

describe('sanitizeText', () => {
  test('returns empty string for non-string input', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(42)).toBe('');
  });

  test('strips control characters but keeps tab/newline content trimmed', () => {
    const dirty = 'hello\x00\x07world';
    expect(sanitizeText(dirty)).toBe('helloworld');
  });

  test('trims surrounding whitespace', () => {
    expect(sanitizeText('  padded  ')).toBe('padded');
  });

  test('truncates to maxLength', () => {
    const long = 'a'.repeat(5000);
    expect(sanitizeText(long).length).toBe(4000);
  });

  test('respects a custom maxLength', () => {
    expect(sanitizeText('abcdef', { maxLength: 3 })).toBe('abc');
  });

  test('preserves ordinary printable text', () => {
    expect(sanitizeText('Normal text 123!')).toBe('Normal text 123!');
  });
});

describe('escapeHtml', () => {
  test('escapes all HTML-significant characters (XSS defence)', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  test('escapes ampersands and single quotes', () => {
    expect(escapeHtml("a & b's")).toBe('a &amp; b&#39;s');
  });

  test('leaves safe text unchanged', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('sanitizeFilename', () => {
  test('strips path separators to prevent traversal (T-27)', () => {
    // Any directory components are removed; only a safe base name remains.
    const out = sanitizeFilename('../../etc/passwd');
    expect(out).not.toContain('/');
    expect(out).not.toContain('..');
    expect(out).toBe('passwd');
  });

  test('replaces unsafe characters with underscore', () => {
    expect(sanitizeFilename('my file@#.png')).toBe('my_file__.png');
  });

  test('falls back to "file" for empty or non-string input', () => {
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename(null)).toBe('file');
    expect(sanitizeFilename('   ')).toBe('file');
  });

  test('strips leading dots (no hidden/relative names)', () => {
    expect(sanitizeFilename('...hidden').startsWith('.')).toBe(false);
  });

  test('truncates very long names', () => {
    const long = 'a'.repeat(300) + '.txt';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(180);
  });
});
