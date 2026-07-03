/**
 * Returns the correct profile/security/account URLs depending on whether the
 * current user is inside the admin shell (/adm/*) or the regular AppShell.
 * Lets UserProfile, TotpSetup, PasswordChange, and DeleteAccount be shared
 * between both surfaces instead of duplicated.
 */
export function securityPaths(isAdmin) {
  return {
    profile: isAdmin ? "/adm/profile" : "/profile",
    twoFa: isAdmin ? "/adm/security/2fa" : "/security/2fa",
    password: isAdmin ? "/adm/security/password" : "/security/password",
    deleteAccount: isAdmin ? "/adm/account/delete" : "/account/delete",
  };
}