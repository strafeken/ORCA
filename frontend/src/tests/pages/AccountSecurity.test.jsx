import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}));
// Both pages may read auth context for the admin/regular path.
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: { role: 'worker' }, isAuthenticated: true }),
}));

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
});
