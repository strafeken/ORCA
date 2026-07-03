import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock useAuth so we can drive each guard's decision deterministically.
vi.mock('../../auth/useAuth', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from '../../auth/useAuth';
import {
  RequireAuth,
  RequireRole,
  RedirectIfAuthed,
} from '../../auth/guards';

/**
 * Tests for auth/guards.jsx — the client-side route guards.
 *
 * These implement the supplementary client-side access checks referenced by
 * SR-25 (server-side RBAC is the real boundary; these are UX only). We verify
 * that each guard routes authenticated/unauthenticated/wrong-role users to the
 * correct place.
 */

// Renders a guard with a protected child and a set of landing routes so we can
// assert where the guard sent the user.
function renderWithGuard(GuardElement, { startPath = '/protected' } = {}) {
  return render(
    <MemoryRouter initialEntries={[startPath]}>
      <Routes>
        <Route element={GuardElement}>
          <Route path="/protected" element={<div>PROTECTED CONTENT</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireAuth', () => {
  test('renders the protected content when authenticated', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, user: { role: 'worker' } });
    renderWithGuard(<RequireAuth />);
    expect(screen.getByText('PROTECTED CONTENT')).toBeInTheDocument();
  });

  test('redirects to /login when not authenticated', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, user: null });
    renderWithGuard(<RequireAuth />);
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    expect(screen.queryByText('PROTECTED CONTENT')).not.toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  test('allows a user whose role is in the allowlist', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, user: { role: 'admin' } });
    renderWithGuard(<RequireRole roles={['admin']} />);
    expect(screen.getByText('PROTECTED CONTENT')).toBeInTheDocument();
  });

  test('redirects an authenticated user with the wrong role to /dashboard', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, user: { role: 'worker' } });
    renderWithGuard(<RequireRole roles={['admin']} />);
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('PROTECTED CONTENT')).not.toBeInTheDocument();
  });

  test('redirects an unauthenticated user to /login', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, user: null });
    renderWithGuard(<RequireRole roles={['admin']} />);
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
  });
});

describe('RedirectIfAuthed', () => {
  test('sends an authenticated user to /dashboard (away from auth pages)', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, user: { role: 'worker' } });
    renderWithGuard(<RedirectIfAuthed />);
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  test('lets an unauthenticated user see the auth page content', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, user: null });
    renderWithGuard(<RedirectIfAuthed />);
    expect(screen.getByText('PROTECTED CONTENT')).toBeInTheDocument();
  });
});
