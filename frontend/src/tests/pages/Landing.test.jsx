import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../../pages/Landing';

function renderLanding() {
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );
}

describe('Landing page', () => {
  test('renders the hero heading', () => {
    renderLanding();
    expect(screen.getByText(/Bring the expert/i)).toBeInTheDocument();
  });

  test('renders sign in and create account links in the nav', () => {
    renderLanding();
    const signIn = screen.getAllByRole('link', { name: /sign in/i })[0];
    const createAccount = screen.getAllByRole('link', { name: /create account/i })[0];
    expect(signIn).toHaveAttribute('href', '/login');
    expect(createAccount).toHaveAttribute('href', '/register');
  });

  test('renders both hero CTA links pointing to the right routes', () => {
    renderLanding();
    const getStarted = screen.getByRole('link', { name: /get started/i });
    const haveAccount = screen.getByRole('link', { name: /i have an account/i });
    expect(getStarted).toHaveAttribute('href', '/register');
    expect(haveAccount).toHaveAttribute('href', '/login');
  });

  test('renders all three role manifest entries', () => {
    renderLanding();
    expect(screen.getByText('On the ground')).toBeInTheDocument();
    expect(screen.getByText('On call')).toBeInTheDocument();
    expect(screen.getByText('On record')).toBeInTheDocument();
  });

  test('renders the footer project credit', () => {
    renderLanding();
    expect(screen.getByText(/ICT2216 · Project ORCA · Group 36/)).toBeInTheDocument();
  });
});