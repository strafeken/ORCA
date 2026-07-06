import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * INTEGRATION tests for the frontend (level 2).
 *
 * Unlike the unit tests (which render one component with everything mocked),
 * these wire the REAL pieces together — AuthProvider + useAuth + the route
 * guards + a page component + react-router — and drive a full user flow. Only
 * the network boundary (fetch / apiFetch) is mocked. This verifies that the
 * auth state machine, the guards (SR-25 client-side RBAC), and routing
 * cooperate correctly end to end:
 *   - a successful login updates context and admits the user past RequireAuth
 *   - an unauthenticated user is redirected away from a protected route
 *   - RedirectIfAuthed bounces a logged-in user off the login page
 */

// Mock only the network layer used by AuthContext / pages.
const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...a) => mockApiFetch(...a),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
  STORAGE_KEY: 'orca.session',
  REFRESH_KEY: 'orca.refresh',
  CSRF_KEY: 'orca.csrf',
}));

import { AuthProvider } from '../../auth/AuthContext';
import { RequireAuth, RedirectIfAuthed } from '../../auth/guards';
import Login from '../../pages/Login';

// A JWT-looking token whose payload decodes to a worker (AuthContext decodes it
// for display; it is never verified client-side).
const WORKER_JWT =
  'eyJhbGciOiJIUzI1NiJ9.' +
  btoa(JSON.stringify({ id: 1, name: 'John', role: 'worker' })).replace(/=/g, '') +
  '.sig';

// Small stand-ins for the protected/landing destinations so we can assert
// where the router lands without pulling the whole app shell.
function Dashboard() { return <div>DASHBOARD PAGE</div>; }
function Protected() { return <div>PROTECTED PAGE</div>; }

function renderApp(initialPath) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          {/* Public auth pages bounce authenticated users away. */}
          <Route element={<RedirectIfAuthed />}>
            <Route path="/login" element={<Login />} />
          </Route>
          {/* Protected area behind the real RequireAuth guard. */}
          <Route element={<RequireAuth />}>
            <Route path="/protected" element={<Protected />} />
          </Route>
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('auth flow integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  test('unauthenticated user hitting a protected route is redirected to /login', () => {
    renderApp('/protected');
    // RequireAuth sends them to the login page instead of the protected content.
    expect(screen.queryByText('PROTECTED PAGE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  test('a successful login updates context and the guard then admits the user', async () => {
    // Seed a session so the provider initialises as authenticated, then confirm
    // RequireAuth lets the protected content render (context + guard cooperating).
    sessionStorage.setItem('orca.session', WORKER_JWT);
    renderApp('/protected');
    await waitFor(() => {
      expect(screen.getByText('PROTECTED PAGE')).toBeInTheDocument();
    });
  });

  test('logging in from the form drives the API and stores the token', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: WORKER_JWT, refreshToken: 'refresh123' }),
    });
    renderApp('/login');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'john@orca.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'WorkerPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      // The login request went through the real AuthContext -> api layer.
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({ method: 'POST' })
      );
      // Token persisted by the context on success.
      expect(sessionStorage.getItem('orca.session')).toBe(WORKER_JWT);
    });
  });

  test('an already-authenticated user is bounced off /login (RedirectIfAuthed)', async () => {
    sessionStorage.setItem('orca.session', WORKER_JWT);
    renderApp('/login');
    // The login form should NOT be shown; the guard redirects to /dashboard.
    await waitFor(() => {
      expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
