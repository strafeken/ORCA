import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiFetch,
  fetchCsrfToken,
  STORAGE_KEY,
  REFRESH_KEY,
  CSRF_KEY,
} from '../../auth/api';

/**
 * Tests for auth/api.js — the authenticated fetch wrapper.
 *
 * This is the single client-side chokepoint that attaches the bearer token
 * (SR-18) and the anti-CSRF token on state-changing requests (SR-28), and that
 * signs the user out on an unrecoverable 401. Verifying it here ensures every
 * API call across the app inherits those protections.
 */
describe('auth/api.js fetch wrapper', () => {
  beforeEach(() => {
    sessionStorage.clear();
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('attaches the bearer token to /api requests (SR-18)', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'access.jwt');
    globalThis.fetch.mockResolvedValue({ status: 200, ok: true });

    await apiFetch('/api/experts');

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer access.jwt');
  });

  test('does NOT attach the bearer token to non-/api URLs', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'access.jwt');
    globalThis.fetch.mockResolvedValue({ status: 200, ok: true });

    await apiFetch('https://other.example.com/thing');

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  test('attaches the CSRF token on a mutating (POST) request (SR-28)', async () => {
    sessionStorage.setItem(CSRF_KEY, 'csrf-abc');
    globalThis.fetch.mockResolvedValue({ status: 200, ok: true });

    await apiFetch('/api/conversations', { method: 'POST', body: '{}' });

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers['x-csrf-token']).toBe('csrf-abc');
  });

  test('does NOT attach a CSRF token on a GET (non-mutating) request', async () => {
    sessionStorage.setItem(CSRF_KEY, 'csrf-abc');
    globalThis.fetch.mockResolvedValue({ status: 200, ok: true });

    await apiFetch('/api/experts'); // GET

    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers['x-csrf-token']).toBeUndefined();
  });

  test('on an unrecoverable 401 (no refresh token) clears all credentials', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'dead.jwt');
    sessionStorage.setItem(CSRF_KEY, 'csrf-abc');
    // No REFRESH_KEY -> cannot refresh -> full sign-out.
    globalThis.fetch.mockResolvedValue({ status: 401, ok: false });

    await apiFetch('/api/experts');

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CSRF_KEY)).toBeNull();
  });

  test('retries once after refreshing the token on a 401 (rotation race, SR-18)', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'old.jwt');
    sessionStorage.setItem(REFRESH_KEY, 'refresh-tok');
    sessionStorage.setItem(CSRF_KEY, 'csrf-abc');

    globalThis.fetch
      // 1) original request -> 401 (token was just rotated)
      .mockResolvedValueOnce({ status: 401, ok: false })
      // 2) /api/auth/refresh -> new token
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ token: 'new.jwt' }) })
      // 3) retried original request -> success
      .mockResolvedValueOnce({ status: 200, ok: true });

    const res = await apiFetch('/api/experts');
    expect(res.status).toBe(200);
    // The refreshed token should now be stored.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('new.jwt');
  });
});

describe('fetchCsrfToken', () => {
  beforeEach(() => {
    sessionStorage.clear();
    globalThis.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  test('stores the CSRF token returned by the server', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ csrfToken: 'server-csrf' }) });
    await fetchCsrfToken();
    expect(sessionStorage.getItem(CSRF_KEY)).toBe('server-csrf');
  });

  test('clears the CSRF token if the request fails', async () => {
    sessionStorage.setItem(CSRF_KEY, 'stale');
    globalThis.fetch.mockRejectedValue(new Error('network'));
    await fetchCsrfToken();
    expect(sessionStorage.getItem(CSRF_KEY)).toBeNull();
  });
});
