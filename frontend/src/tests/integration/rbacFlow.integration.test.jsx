import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * INTEGRATION tests for role-based access control on the client (level 2).
 *
 * Wires AuthProvider + RequireRole/RequireAdmin + routing together and checks
 * that a session's role drives where the router lands (SR-25 client-side RBAC,
 * the UX layer over the authoritative server-side checks). A worker must not
 * reach an admin-only route; an admin must.
 */
vi.mock('../../auth/api', () => ({
  apiFetch: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
  STORAGE_KEY: 'orca.session',
  REFRESH_KEY: 'orca.refresh',
  CSRF_KEY: 'orca.csrf',
}));

import { AuthProvider } from '../../auth/AuthContext';
import { RequireRole, RequireAdmin } from '../../auth/guards';

function jwtFor(role) {
  return 'eyJhbGciOiJIUzI1NiJ9.' +
    btoa(JSON.stringify({ id: 1, name: 'U', role })).replace(/=/g, '') + '.sig';
}

function AdminArea() { return <div>ADMIN AREA</div>; }
function WorkerArea() { return <div>WORKER AREA</div>; }
function Dashboard() { return <div>DASHBOARD</div>; }
function AdminLogin() { return <div>ADMIN LOGIN</div>; }

function renderApp(initialPath) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/admin-thing" element={<AdminArea />} />
          </Route>
          <Route element={<RequireRole roles={['worker', 'expert']} />}>
            <Route path="/worker-thing" element={<WorkerArea />} />
          </Route>
          <Route element={<RequireAdmin />}>
            <Route path="/adm/panel" element={<AdminArea />} />
          </Route>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/adm/administratorLogin" element={<AdminLogin />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('client-side RBAC integration (SR-25)', () => {
  beforeEach(() => sessionStorage.clear());

  test('a worker is kept out of an admin-only route and sent to /dashboard', async () => {
    sessionStorage.setItem('orca.session', jwtFor('worker'));
    renderApp('/admin-thing');
    await waitFor(() => {
      expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
    });
    expect(screen.queryByText('ADMIN AREA')).not.toBeInTheDocument();
  });

  test('an admin can reach an admin-only route', async () => {
    sessionStorage.setItem('orca.session', jwtFor('admin'));
    renderApp('/admin-thing');
    await waitFor(() => {
      expect(screen.getByText('ADMIN AREA')).toBeInTheDocument();
    });
  });

  test('a worker can reach a worker/expert route', async () => {
    sessionStorage.setItem('orca.session', jwtFor('worker'));
    renderApp('/worker-thing');
    await waitFor(() => {
      expect(screen.getByText('WORKER AREA')).toBeInTheDocument();
    });
  });

  test('RequireAdmin sends an unauthenticated user to the admin login', async () => {
    // No session set.
    renderApp('/adm/panel');
    await waitFor(() => {
      expect(screen.getByText('ADMIN LOGIN')).toBeInTheDocument();
    });
    expect(screen.queryByText('ADMIN AREA')).not.toBeInTheDocument();
  });

  test('RequireAdmin admits an admin to the /adm panel', async () => {
    sessionStorage.setItem('orca.session', jwtFor('admin'));
    renderApp('/adm/panel');
    await waitFor(() => {
      expect(screen.getByText('ADMIN AREA')).toBeInTheDocument();
    });
  });
});
