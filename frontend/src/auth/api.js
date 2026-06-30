// Shared HTTP helper + storage key, kept out of AuthContext.jsx so React
// fast-refresh stays happy (that file must export only components).

export const STORAGE_KEY  = "orca.session";
const        REFRESH_KEY  = "orca.refresh";

/**
 * Authenticated fetch wrapper.
 *
 * Attaches the stored bearer token to every /api request. Also intercepts
 * 401 responses globally: if any API call comes back with 401 it means the
 * server has rejected the session (revoked by an admin, expert approval
 * revoked, account deleted, or natural JWT expiry). In that case we clear
 * all local credentials and force a redirect to the appropriate login page
 * so the user cannot continue browsing on a dead session.
 *
 * Why here instead of in each page: every page would need to handle this
 * individually and would likely miss edge cases. A single intercept point
 * in the shared fetch wrapper guarantees consistent behaviour regardless of
 * which API call triggers the 401.
 *
 * Admin pages (/adm/*) redirect to /adm/administratorLogin.
 * All other pages redirect to /login.
 */
export async function apiFetch(url, options = {}) {
  const token = sessionStorage.getItem(STORAGE_KEY);
  const headers = { ...(options.headers || {}) };
  if (token && url.startsWith("/api")) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  // Global 401 handler — session revoked or expired on the server side.
  if (response.status === 401) {
    // Clear every stored credential so the user is fully signed out locally.
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(REFRESH_KEY);

    // Redirect to the correct login page based on where the user is now.
    // Admin panel pages live under /adm/; everyone else uses /login.
    const isAdminPath = window.location.pathname.startsWith("/adm/");
    const loginPath   = isAdminPath ? "/adm/administratorLogin" : "/login";

    // Only redirect if we aren't already on a login page (avoids redirect
    // loops if the login page itself makes an unauthenticated API call).
    const alreadyOnLogin =
      window.location.pathname === "/adm/administratorLogin" ||
      window.location.pathname === "/login";

    if (!alreadyOnLogin) {
      window.location.replace(loginPath);
    }
  }

  return response;
}