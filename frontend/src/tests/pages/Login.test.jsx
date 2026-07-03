import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useAuth and the navigate hook so we can drive login outcomes.
const mockLogin = vi.fn();
const mockNavigate = vi.fn();
let authState = { login: mockLogin, loading: false, error: null };

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => authState,
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

import Login from '../../pages/Login';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

/**
 * Tests for pages/Login.jsx — the sign-in form and its two-factor handling.
 * Covers: successful login navigates to dashboard; a TOTP-required response
 * reveals the code field (SR-21 second factor); errors are shown.
 */
describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = { login: mockLogin, loading: false, error: null };
  });

  test('renders email, password, and sign-in button', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  test('shows a "forgot password" link', () => {
    renderLogin();
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
  });

  test('calls login and navigates to dashboard on success', async () => {
    mockLogin.mockResolvedValue({ token: 't' });
    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'john@orca.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'WorkerPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('john@orca.com', 'WorkerPass123!', undefined);
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  test('reveals the TOTP code field when login reports totpRequired', async () => {
    // First submit rejects with a totpRequired error.
    const err = new Error('TOTP code required.');
    err.totpRequired = true;
    mockLogin.mockRejectedValueOnce(err);

    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'john@orca.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'WorkerPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // The 6-digit authentication code field should now appear.
    await waitFor(() => {
      expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
    });
  });

  test('shows a validation message when fields are empty', async () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText(/enter your email and password/i)).toBeInTheDocument();
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  test('surfaces an auth error from context', () => {
    authState = { login: mockLogin, loading: false, error: 'Email or password is incorrect.' };
    renderLogin();
    expect(screen.getByText(/email or password is incorrect/i)).toBeInTheDocument();
  });
});
