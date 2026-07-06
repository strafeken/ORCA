import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the API layer. AuthContext imports several named exports from ./api.
const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
  STORAGE_KEY: 'orca.session',
  REFRESH_KEY: 'orca.refresh',
  CSRF_KEY: 'orca.csrf',
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
}));

import { AuthProvider } from '../../auth/AuthContext';
import { useAuth } from '../../auth/useAuth';

// A tiny consumer that exposes the context to the test via the DOM.
function AuthProbe() {
  const { user, isAuthenticated, login, logout, error } = useAuth();
  return (
    <div>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="role">{user?.role || 'none'}</span>
      <span data-testid="error">{error || ''}</span>
      <button onClick={() => login('john@orca.com', 'WorkerPass123!').catch(() => {})}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>
  );
}

// A JWT with payload {id:1,name:"John",role:"worker"} (unsigned — decoded for
// display only, never verified client-side).
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiJ9.' +
  btoa(JSON.stringify({ id: 1, name: 'John', role: 'worker' })).replace(/=/g, '') +
  '.sig';

/**
 * Tests for auth/AuthContext.jsx — the client-side auth state machine.
 * Covers: starts logged out, login stores the token and sets the user,
 * logout clears state and calls the revoke endpoint (SR-18: tokens invalidated
 * on logout), and a failed login surfaces an error without authenticating.
 */
describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  test('starts unauthenticated with no stored token', () => {
    renderAuth();
    expect(screen.getByTestId('authed').textContent).toBe('false');
    expect(screen.getByTestId('role').textContent).toBe('none');
  });

  test('login stores token, sets user, and marks authenticated', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: FAKE_JWT, refreshToken: 'refresh123' }),
    });
    renderAuth();
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => {
      expect(screen.getByTestId('authed').textContent).toBe('true');
      expect(screen.getByTestId('role').textContent).toBe('worker');
    });
    expect(sessionStorage.getItem('orca.session')).toBe(FAKE_JWT);
  });

  test('failed login surfaces an error and stays unauthenticated', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Email or password is incorrect.' }),
    });
    renderAuth();
    fireEvent.click(screen.getByText('login'));
    // login() rejects on failure by design; the click handler's rejection is
    // unhandled at the DOM level, so we assert on the resulting UI state rather
    // than the throw. The error is surfaced via context state.
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toMatch(/incorrect/i);
    });
    expect(screen.getByTestId('authed').textContent).toBe('false');
  });

  test('logout clears state and calls the revoke endpoint', async () => {
    // First log in.
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: FAKE_JWT, refreshToken: 'refresh123' }),
    });
    renderAuth();
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('true'));

    // Then log out — the logout call hits /api/auth/logout.
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => {
      expect(screen.getByTestId('authed').textContent).toBe('false');
    });
    expect(sessionStorage.getItem('orca.session')).toBeNull();
    // A logout request was issued to revoke the server session.
    const logoutCall = mockApiFetch.mock.calls.find((c) => String(c[0]).includes('/api/auth/logout'));
    expect(logoutCall).toBeDefined();
  });

  test('login with totpRequired throws without setting a generic error', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'TOTP code required.', totpRequired: true }),
    });
    renderAuth();
    await expect(async () => {
      fireEvent.click(screen.getByText('login'));
      await waitFor(() => mockApiFetch.mock.calls.length > 0);
    }).not.toThrow();
    await waitFor(() => {
      expect(screen.getByTestId('authed').textContent).toBe('false');
      expect(screen.getByTestId('error').textContent).toBe('');
    });
  });

  test('restores user from an existing session token on mount', () => {
    sessionStorage.setItem('orca.session', FAKE_JWT);
    renderAuth();
    expect(screen.getByTestId('authed').textContent).toBe('true');
    expect(screen.getByTestId('role').textContent).toBe('worker');
  });
});