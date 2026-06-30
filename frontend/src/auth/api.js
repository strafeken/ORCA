// Shared HTTP helper + storage key, kept out of AuthContext.jsx so React
// fast-refresh stays happy (that file must export only components).

export const STORAGE_KEY  = "orca.session";
export const CSRF_KEY = "orca.csrf";

let csrfFetchPromise = null;

// Call once on app startup to fetch and cache the CSRF token
export function fetchCsrfToken() {
  if (csrfFetchPromise) return csrfFetchPromise;

  csrfFetchPromise = fetch("/api/csrf-token", { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to fetch CSRF token");
      const data = await res.json();
      if (data.csrfToken) {
        sessionStorage.setItem(CSRF_KEY, data.csrfToken);
      }
    })
    .catch(() => {
      sessionStorage.removeItem(CSRF_KEY);
    })
    .finally(() => {
      csrfFetchPromise = null;
    });

  return csrfFetchPromise;
}

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
  const method = (options.method || "GET").toUpperCase();
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  // If mutating and storage is empty, wait for the token initialization
  if (mutating && !sessionStorage.getItem(CSRF_KEY)) {
    await fetchCsrfToken();
  }

  let token = sessionStorage.getItem(STORAGE_KEY);
  let csrfToken = sessionStorage.getItem(CSRF_KEY);
  let headers = { ...options.headers };

  if (token && url.startsWith("/api")) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (mutating && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  let response = await fetch(url, { ...options, headers, credentials: "include" });

  // If the server rejects the token, try refreshing it ONCE automatically 
  // before giving up or throwing a false error.
  if (response.status === 403 && mutating) {
    const errorData = await response.clone().json().catch(() => ({}));
    if (errorData.error === "invalid csrf token" || errorData.message?.includes("csrf")) {
      
      // Force fetch a clean, synchronized token
      await fetchCsrfToken();
      csrfToken = sessionStorage.getItem(CSRF_KEY);
      
      if (csrfToken) {
        // Re-attach the new token and retry the request silently
        headers["x-csrf-token"] = csrfToken;
        response = await fetch(url, { ...options, headers, credentials: "include" });
      }
    }
  }

  // Global 401 handler — session revoked or expired on the server side.
  if (response.status === 401) {
    // Clear every stored credential so the user is fully signed out locally.
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(CSRF_KEY);

    // Redirect to the correct login page based on where the user is now.
    // Admin panel pages live under /adm/; everyone else uses /login.
    const isAdminPath = window.location.pathname.startsWith("/adm/");
    const loginPath = isAdminPath ? "/adm/administratorLogin" : "/login";

    // Only redirect if we aren't already on a login page (avoids redirect
    // loops if the login page itself makes an unauthenticated API call).
    const alreadyOnLogin = window.location.pathname === "/adm/administratorLogin" || window.location.pathname === "/login";

    if (!alreadyOnLogin) {
      await fetchCsrfToken(); // get a fresh token before redirecting
      window.location.replace(loginPath);
    }
  }

  return response;
}