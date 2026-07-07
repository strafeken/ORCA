// Shared HTTP helper + storage key, kept out of AuthContext.jsx so React
// fast-refresh stays happy (that file must export only components).

export const STORAGE_KEY  = "orca.session";
export const REFRESH_KEY  = "orca.refresh";
export const CSRF_KEY = "orca.csrf";

let csrfFetchPromise = null;

function refreshHeaders(extra = {}) {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  return refreshToken ? { "x-refresh-token": refreshToken, ...extra } : extra;
}

/**
 * Fetch and cache a CSRF token bound to the CURRENT session identity.
 *
 * The backend binds each CSRF token to a session identifier — the refresh token
 * once logged in, or an anonymous context before login (see getSessionIdentifier
 * in backend/app.js). That identifier changes at login and at logout, so a token
 * cached under the previous identity is stale and the next mutating request is
 * rejected with EBADCSRFTOKEN.
 *
 * Concurrent callers are normally deduped onto a single in-flight request. But a
 * caller that runs RIGHT AFTER the identity changed (post-login, post-logout, or
 * the CSRF-rejection retry) must NOT be handed a request that STARTED under the
 * old identity — otherwise it caches a token bound to the wrong identifier. Such
 * callers pass { force: true } to always issue a fresh request bound to the
 * identity as it is now.
 */
export function fetchCsrfToken({ force = false } = {}) {
  if (csrfFetchPromise && !force) return csrfFetchPromise;

  const p = fetch("/api/csrf-token", {
    credentials: "include",
    headers: refreshHeaders(),
  })
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
      // Only clear the shared handle if it still points at THIS request, so a
      // slow stale fetch resolving late can't wipe a newer forced fetch's handle.
      if (csrfFetchPromise === p) csrfFetchPromise = null;
    });

  csrfFetchPromise = p;
  return p;
}

let refreshPromise = null;

function buildRequestHeaders(url, options, mutating) {
  const token = sessionStorage.getItem(STORAGE_KEY);
  const csrfToken = sessionStorage.getItem(CSRF_KEY);
  const headers = refreshHeaders({ ...options.headers });

  if (token && url.startsWith("/api")) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (mutating && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }
  return headers;
}

async function retryOnCsrfFailure(url, options, headers, response) {
  const method = (options.method || "GET").toUpperCase();
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (response.status !== 403 || !mutating) return response;

  const errorData = await response.clone().json().catch(() => ({}));
  if (errorData.code !== "CSRF_INVALID") return response;

  await fetchCsrfToken({ force: true });
  const csrfToken = sessionStorage.getItem(CSRF_KEY);
  if (csrfToken) {
    headers["x-csrf-token"] = csrfToken;
    return fetch(url, { ...options, headers, credentials: "include" });
  }
  return response;
}

async function signOutOnUnauthorized() {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(CSRF_KEY);

  const isAdminPath = globalThis.location.pathname.startsWith("/adm/");
  const loginPath = isAdminPath ? "/adm/administratorLogin" : "/login";
  const alreadyOnLogin =
    globalThis.location.pathname === "/adm/administratorLogin"
    || globalThis.location.pathname === "/login";

  if (alreadyOnLogin) return;

  await fetchCsrfToken({ force: true });
  globalThis.location.replace(loginPath);
}

/**
 * Exchange the refresh token for a fresh access token, storing it. Returns the
 * new token, or null if refresh isn't possible (no refresh token, or the server
 * rejected it — i.e. the session really is dead).
 *
 * Deduped via a shared promise: during a server-side token rotation, several
 * in-flight requests can 401 at once — they all await the SAME refresh instead
 * of firing a stampede of /refresh calls. Uses a raw fetch (not apiFetch) so a
 * failing refresh can't recurse back into this handler.
 */
function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;

    // /refresh is a state-changing POST — it needs a CSRF token bound to the
    // refresh-token session identifier.
    if (!sessionStorage.getItem(CSRF_KEY)) await fetchCsrfToken();
    const csrfToken = sessionStorage.getItem(CSRF_KEY);

    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-refresh-token": refreshToken,
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      if (data.token) {
        sessionStorage.setItem(STORAGE_KEY, data.token);
        return data.token;
      }
      return null;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
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

  if (mutating && !sessionStorage.getItem(CSRF_KEY)) {
    await fetchCsrfToken();
  }

  const headers = buildRequestHeaders(url, options, mutating);
  let response = await fetch(url, { ...options, headers, credentials: "include" });

  response = await retryOnCsrfFailure(url, options, headers, response);

  if (
    response.status === 401
    && !options.__retried
    && !url.includes("/api/auth/refresh")
    && sessionStorage.getItem(REFRESH_KEY)
  ) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch(url, { ...options, __retried: true });
    }
  }

  if (response.status === 401) {
    await signOutOnUnauthorized();
  }

  return response;
}
