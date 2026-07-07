/**
 * Password policy middleware — NIST SP 800-63B §5.1.1.2 (memorized secret verifiers).
 *
 * Enforces a minimum length, context-specific and common-password blocklists, and
 * an optional Have I Been Pwned (HIBP) Pwned Passwords range query (k-anonymity).
 *
 * Fail-open on HIBP: local checks are the enforced baseline. If the HIBP API
 * errors, times out, or returns a non-200 response, the request proceeds as if
 * the password were not found in breach corpora (a warning is logged). This
 * keeps registration/password-change available when the external service is down.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { system } = require('../utils/winstonLogger');
const { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } = require('../constants/passwordPolicy');

const BLOCKLIST_PATH = path.join(__dirname, '../data/common-passwords.txt');
const MIN_LENGTH = MIN_PASSWORD_LENGTH;
const MAX_LENGTH = MAX_PASSWORD_LENGTH;
const HIBP_TIMEOUT_MS = 2000;
const GENERIC_BANNED = ['orca', 'admin', 'worker', 'expert', 'password'];

/** @type {Set<string>} */
const commonPasswords = new Set(
  fs
    .readFileSync(BLOCKLIST_PATH, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
);

function extractPassword(req) {
  if (typeof req.body?.password === 'string') return req.body.password;
  if (typeof req.body?.newPassword === 'string') return req.body.newPassword;
  return null;
}

function collectContextBannedWords(req) {
  const words = [...GENERIC_BANNED];

  const name = (req.body?.name || req.user?.name || '').trim();
  if (name) words.push(name.toLowerCase());

  const emailRaw = (req.body?.email || req.user?.email || '').trim().toLowerCase();
  if (emailRaw.includes('@')) {
    words.push(emailRaw.split('@')[0]);
  }

  return words;
}

function lengthError(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (password.length > MAX_LENGTH) {
    return 'Password is too long.';
  }
  return null;
}

function contextBannedError(password, req) {
  const lower = password.toLowerCase();
  for (const word of collectContextBannedWords(req)) {
    if (!word) continue;
    if (lower === word || lower.includes(word)) {
      return 'Password must not contain your name, email, or common application terms.';
    }
  }
  return null;
}

function blocklistError(password) {
  if (commonPasswords.has(password.toLowerCase())) {
    return 'Password is too common. Choose something less easily guessed.';
  }
  return null;
}

async function hibpBreachedError(password) {
  // HIBP Pwned Passwords k-anonymity requires SHA-1; only the 5-char prefix is sent.
  const digest = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ORCA-Password-Check' },
    });

    if (!response.ok) {
      system.warn('HIBP Pwned Passwords API returned non-200; failing open', {
        context: 'passwordCheck',
        status: response.status,
      });
      return null;
    }

    const body = await response.text();
    for (const line of body.split('\n')) {
      const [hashSuffix] = line.trim().split(':');
      if (
        hashSuffix.length === suffix.length &&
        crypto.timingSafeEqual(Buffer.from(hashSuffix), Buffer.from(suffix))
      ) {
        return 'This password has appeared in a known data breach. Choose a different password.';
      }
    }
    return null;
  } catch (err) {
    system.warn('HIBP Pwned Passwords API unavailable; failing open', {
      context: 'passwordCheck',
      error: err.message,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function passwordPolicyMiddleware(req, res, next) {
  const password = extractPassword(req);
  if (typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const checks = [
    lengthError(password),
    contextBannedError(password, req),
    blocklistError(password),
  ];

  for (const err of checks) {
    if (err) return res.status(400).json({ error: err });
  }

  const hibpErr = await hibpBreachedError(password);
  if (hibpErr) return res.status(400).json({ error: hibpErr });

  return next();
}

module.exports = { passwordPolicyMiddleware, commonPasswords, MIN_LENGTH, MAX_LENGTH };
