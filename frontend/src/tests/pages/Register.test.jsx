import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the API helpers used by Register.
const mockApiFetch = vi.fn();
vi.mock('../../auth/api', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('csrf'),
}));

import Register from '../../pages/Register';

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Smith' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@orca.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'WorkerPass123!' } });
}

/**
 * Tests for pages/Register.jsx — account creation form.
 * Covers: client-side validation, the worker/expert role toggle, the success
 * panel shown after a 202 (which is worded to avoid account enumeration), and
 * error surfacing.
 */
describe('Register page', () => {
  beforeEach(() => vi.clearAllMocks());

  test('renders name, email, password fields and role options', () => {
    renderRegister();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^worker$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^expert$/i })).toBeInTheDocument();
  });

  test('rejects a password shorter than 12 chars without calling the API', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@orca.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('shows the worker success panel after a successful signup', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    renderRegister();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/almost there/i)).toBeInTheDocument();
    });
    // Anti-enumeration wording: conditional, not a definite "we sent it".
    expect(screen.getByText(/isn't already registered/i)).toBeInTheDocument();
  });

  test('shows the expert approval message when expert role is chosen', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    renderRegister();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /^expert$/i })); // switch role
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/awaiting admin approval/i)).toBeInTheDocument();
    });
  });

  test('surfaces a server error message', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Registration failed.' }) });
    renderRegister();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument();
    });
  });
});
