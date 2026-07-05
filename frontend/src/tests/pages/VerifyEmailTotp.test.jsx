import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}));

import VerifyEmail from '../../pages/VerifyEmail';
import TotpSetup from '../../pages/TotpSetup';

/**
 * Tests for the verification & 2FA pages.
 *   VerifyEmail  — FR-02 / SR-19: a Worker account is activated only after the
 *                  email-verification token is confirmed by the backend.
 *   TotpSetup    — SR-21: TOTP soft-token second factor for account recovery.
 */
describe('VerifyEmail (FR-02 / SR-19)', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderWithToken(token) {
    const path = token ? `/verify-email?token=${token}` : '/verify-email';
    return render(
      <MemoryRouter initialEntries={[path]}>
        <VerifyEmail />
      </MemoryRouter>
    );
  }

  test('shows an error state when no token is present in the URL', () => {
    renderWithToken(null);
    expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
    // With no token it must not call the backend.
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('calls the verify endpoint with the token from the URL', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    renderWithToken('abc123');
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/verify-email?token=abc123')
      );
    });
  });

  test('shows success when the backend confirms the token', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    renderWithToken('validtoken');
    await waitFor(() => {
      expect(screen.getByText(/email verified/i)).toBeInTheDocument();
    });
  });

  test('shows failure when the backend rejects the token', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid token' }) });
    renderWithToken('badtoken');
    await waitFor(() => {
      expect(screen.getByText(/verification failed/i)).toBeInTheDocument();
    });
  });
});

describe('TotpSetup (SR-21)', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderTotp() {
    return render(
      <MemoryRouter>
        <TotpSetup />
      </MemoryRouter>
    );
  }

  test('renders the 2FA heading and an enable action', () => {
    renderTotp();
    expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
  });

  test('requests a TOTP secret/QR from the backend when setup starts', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ qr: 'data:image/png;base64,xxx', otpauth: 'otpauth://x' }),
    });
    renderTotp();
    const startBtn = screen.getByRole('button');
    startBtn.click();
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/totp/setup', { method: 'POST' });
    });
  });
});
