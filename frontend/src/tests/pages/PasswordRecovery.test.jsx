import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}));

import ForgotPassword from '../../pages/ForgotPassword';
import ResetPassword from '../../pages/ResetPassword';

/**
 * Tests for the password-recovery pages (SR-21 account recovery via reset link).
 * ForgotPassword always shows the same confirmation (anti-enumeration);
 * ResetPassword validates the new password and posts it with the URL token.
 */
describe('ForgotPassword page', () => {
  beforeEach(() => vi.clearAllMocks());

  test('renders an email field and submit button', () => {
    render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  test('shows a generic confirmation after submitting (anti-enumeration)', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'john@orca.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });
});

describe('ResetPassword page', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderWithToken(token = 'validtoken') {
    return render(
      <MemoryRouter initialEntries={[`/reset-password?token=${token}`]}>
        <ResetPassword />
      </MemoryRouter>
    );
  }

  test('renders new-password and confirm fields', () => {
    renderWithToken();
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  test('rejects mismatched passwords without calling the API', async () => {
    renderWithToken();
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'LongEnough123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Different123!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('rejects a password shorter than 12 chars', async () => {
    renderWithToken();
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      // Match the error alert specifically ("Password must be at least 12
      // characters"), not the page description which also mentions the phrase.
      expect(screen.getByText(/password must be at least 12 characters/i)).toBeInTheDocument();
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('posts the token and new password on a valid submit', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    renderWithToken('mytoken123');
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'NewWorkerPass123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'NewWorkerPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/auth/reset-password',
        expect.objectContaining({ method: 'POST' })
      );
    });
    // The request body should carry the token from the URL and the new password.
    const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
    expect(body.token).toBe('mytoken123');
    expect(body.password).toBe('NewWorkerPass123!');
  });
});
