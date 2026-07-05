import { describe, test, expect } from 'vitest';
import { securityPaths } from '../../auth/securityPaths';

/**
 * Tests for auth/securityPaths.js — resolves profile/security/account URLs for
 * the admin shell vs the regular shell, so shared pages (UserProfile,
 * TotpSetup, PasswordChange, DeleteAccount) route correctly on both surfaces.
 */
describe('securityPaths', () => {
  test('returns admin-scoped paths when isAdmin is true', () => {
    const p = securityPaths(true);
    expect(p.profile).toBe('/adm/profile');
    expect(p.twoFa).toBe('/adm/security/2fa');
    expect(p.password).toBe('/adm/security/password');
  });

  test('returns regular paths when isAdmin is false', () => {
    const p = securityPaths(false);
    expect(p.profile).toBe('/profile');
    expect(p.twoFa).toBe('/security/2fa');
    expect(p.password).toBe('/security/password');
  });

  test('account deletion path is the same on both surfaces', () => {
    expect(securityPaths(true).deleteAccount).toBe('/account/delete');
    expect(securityPaths(false).deleteAccount).toBe('/account/delete');
  });
});
