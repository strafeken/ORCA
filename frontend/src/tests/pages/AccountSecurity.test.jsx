import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}));
const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockNavigate = vi.fn();
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: { role: 'worker' }, isAuthenticated: true, logout: mockLogout }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import PasswordChange from '../../pages/PasswordChange';
import DeleteAccount from '../../pages/DeleteAccount';


/**
 * Tests for the two account-security pages that require re-authentication.
 *   PasswordChange — FR-04: "require re-authentication before a password change
 *                    is accepted." The page must confirm the current password
 *                    first (reauth step) before allowing the new password.
 *   DeleteAccount  — same re-auth gate before a destructive account action.
 */
describe('PasswordChange (FR-04 re-authentication)', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderPage() {
    return render(<MemoryRouter><PasswordChange /></MemoryRouter>);
  }

  test('starts on the re-auth step asking for the current password', () => {
    renderPage();
    expect(screen.getByText(/change password/i)).toBeInTheDocument();
    // The current-password field is present as the first gate.
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  test('calls the reauth endpoint before allowing the change (FR-04)', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'WorkerPass123!' },
    });
    // Submit the reauth step.
    fireEvent.click(screen.getByRole('button', { name: /continue|verify|next/i }));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/users/me/reauth',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  test('a failed reauth shows an error and does not advance', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Incorrect password.' }) });
    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue|verify|next/i }));
    await waitFor(() => {
      expect(screen.getByText(/incorrect password/i)).toBeInTheDocument();
    });
  });

  test('advances to the change step and submits a new password', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'ok' }) });

    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'WorkerPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/re-enter password/i)).toBeInTheDocument();
    });

    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'NewValidPass99!' } });
    fireEvent.change(inputs[1], { target: { value: 'NewValidPass99!' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/users/me/password',
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(screen.getByText(/password has been changed/i)).toBeInTheDocument();
    });
  });

  test('shows a mismatch error before calling the API', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'WorkerPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/re-enter password/i)).toBeInTheDocument();
    });

    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'NewValidPass99!' } });
    fireEvent.change(inputs[1], { target: { value: 'DifferentPass99!' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteAccount (re-authentication before destructive action)', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderPage() {
    return render(<MemoryRouter><DeleteAccount /></MemoryRouter>);
  }

  test('requires the current password before deletion can proceed', () => {
    renderPage();
    expect(screen.getByText(/delete account/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  test('calls the reauth endpoint first with the entered password', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'WorkerPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue|confirm|verify|next/i }));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/users/me/reauth',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  test('deletes the account after confirmation and logs out', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'deleted' }) });

    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'WorkerPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/delete your account/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  test('returns to reauth when cancel is clicked on the confirm step', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    renderPage();
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'WorkerPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByText(/confirm your password to continue/i)).toBeInTheDocument();
  });
});
