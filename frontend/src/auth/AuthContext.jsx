import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AuthContext } from "./context";
import { apiFetch, STORAGE_KEY, REFRESH_KEY, fetchCsrfToken, CSRF_KEY } from "./api";

/**
 * AuthContext — the single source of truth for "who is logged in".
 *
 * login() and logout() are wired to the real backend auth endpoints. The shape
 * of `user` ({ id, name, role }) is what the rest of the app expects.
 *
 * Token storage: keeps the access token in sessionStorage. The refresh token is
 * stored separately so logout can revoke the server session.
 *
 * Session lifetime model (mirrors the server — see backend/utils/tokens.js and
 * backend/middleware/authMiddleware.js):
 *   - Access token (JWT): 15 minutes.
 *   - Absolute session cap: 2 hours, after which the session can't be
 *     refreshed no matter how active the user is.
 *   - Inactivity timeout: 15 minutes. If the user makes no real interaction
 *     (mouse/keyboard/touch/scroll) for that long, the session is ended even
 *     though neither of the above has been reached.
 *
 * Because the access token only lives 15 minutes and the server enforces the
 * 15-minute idle timeout on every request, this provider has to do two things
 * in the background for an active session to feel "logged in" at all:
 *   1. Silently refresh the access token periodically WHILE the user is
 *      genuinely active, so they aren't logged out mid-session purely
 *      because 15 minutes of wall-clock time passed.
 *   2. Proactively log the user out client-side once they've been idle for
 *      15 minutes, rather than waiting for some future API call to fail.
 */

// Mirrors backend/middleware/authMiddleware.js INACTIVITY_TIMEOUT_MS. Kept as
// a separate constant (not imported, since this is a different runtime) —
// if you change one, change the other.
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Refresh comfortably before the 15-minute access token actually expires.
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// How often to ping the server to discover an admin-side revocation
// (session terminated, expert approval revoked, account deleted) even on a
// page that makes no other API calls of its own.
const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 20 seconds

// Real user interaction events. Deliberately does NOT include the background
// heartbeat/refresh fetches themselves — only things an actual human does.
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "wheel", "touchstart"];

// Decode a JWT payload without verifying it (display only — the server is the
// authority on every request; this is purely so the navbar can show a
// name/role before the first API round-trip).
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(STORAGE_KEY) || null);
  const [user, setUser] = useState(() => {
    const t = sessionStorage.getItem(STORAGE_KEY);
    return t ? decodeJwt(t) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Ref (not state) so updating it on every mousemove doesn't trigger
  // re-renders — it only needs to be read by the interval check below.
  // Starts as null and is set inside the effect below (not here) because
  // useRef's argument is evaluated during render, and calling an impure
  // function like Date.now() directly in render is flagged by React's
  // purity rule (effects, unlike render, are allowed to be impure).
  const lastActivityRef = useRef(null);

  // Current route — used to treat navigation as user activity (see the effect
  // further down). AuthProvider is rendered inside <BrowserRouter>, so this is
  // available here.
  const location = useLocation();

  const persist = useCallback((newToken, refreshToken) => {
    if (newToken) {
      sessionStorage.setItem(STORAGE_KEY, newToken);
      if (refreshToken) {
        sessionStorage.setItem(REFRESH_KEY, refreshToken);
      }
      setToken(newToken);
      setUser(decodeJwt(newToken));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
      setToken(null);
      setUser(null);
    }
  }, []);

  /**
   * Real login. Calls POST /api/auth/login. On success the backend returns
   * { token, refreshToken, user }. If the account has 2FA enabled and no/invalid
   * code was supplied, the backend returns { totpRequired: true } — we throw a
   * special error the Login page catches to prompt for a code.
   */
  const login = useCallback(
    async (email, password, totp) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, totp }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Signal the UI to ask for a TOTP code rather than showing an error.
          if (data.totpRequired) {
            const e = new Error(data.error || "TOTP code required.");
            e.totpRequired = true;
            throw e;
          }
          throw new Error(data.error || "Email or password is incorrect.");
        }
        persist(data.token, data.refreshToken);
        // Rebind the CSRF token to the new refresh-token identity. Forced so it
        // can't reuse an in-flight fetch still bound to the anonymous identity,
        // which would leave the next mutating request failing CSRF validation.
        await fetchCsrfToken({ force: true });
        lastActivityRef.current = Date.now();
        return data;
      } catch (err) {
        // Don't show the "TOTP required" as a red error — the page handles it.
        if (!err.totpRequired) setError(err.message || "Login failed.");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [persist]
  );

  /**
   * Logout. Revokes the server session (so the refresh token can't be reused)
   * then clears local state. Always clears locally even if the network call
   * fails — the user should always be able to log out of this device.
   */
  const logout = useCallback(async () => {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
    } catch {
      // ignore network errors on logout
    }
    persist(null);
    sessionStorage.removeItem(CSRF_KEY);
    // Rebind the CSRF token to the anonymous identity now that the refresh token
    // is gone (forced, for the same reason as login above).
    await fetchCsrfToken({ force: true });
  }, [persist]);

  /**
   * Track real user interaction (not background fetches) so the idle check
   * below has an honest signal. Attached once, independent of auth state —
   * cheap timestamp writes, no harm if logged out.
   */
  useEffect(() => {
    // Seed the initial value here rather than in useRef() above — see the
    // comment on lastActivityRef's declaration.
    lastActivityRef.current = Date.now();

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((evt) => globalThis.addEventListener(evt, markActive, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((evt) => globalThis.removeEventListener(evt, markActive));
    };
  }, []);

  /**
   * Navigation counts as activity. A static page like the dashboard makes no
   * API call of its own, so without this, moving there would neither reset the
   * client idle clock (for programmatic/back-forward navigation that fires no
   * DOM event) nor the server's last_activity. On every route change we mark
   * the user active locally and — while signed in — ping the touching
   * /api/auth/activity endpoint so the server's 15-minute inactivity clock
   * resets too. (A background poll is deliberately NOT counted as activity; a
   * deliberate navigation is.)
   */
  useEffect(() => {
    lastActivityRef.current = Date.now();
    if (sessionStorage.getItem(STORAGE_KEY)) {
      // Promise.resolve wraps the call so a non-thenable return (e.g. a mocked
      // apiFetch in tests) can't throw synchronously; in production apiFetch
      // already returns a promise, so this is a no-op. A failed touch is
      // non-fatal — a genuinely dead session is handled by apiFetch's global
      // 401 logic, and transient errors are ignored.
      Promise.resolve(apiFetch("/api/auth/activity")).catch(() => {});
    }
  }, [location.pathname]);

  /**
   * Session heartbeat + idle timeout + silent token refresh.
   *
   * Three independent concerns share one effect (scoped to `token` so it only
   * runs while signed in):
   *
   *   1. HEARTBEAT — `user` above is decoded from the locally-stored JWT, so
   *      it stays "valid" in the UI for the lifetime of the token even if the
   *      server has revoked the underlying session (an admin terminating it
   *      from /admin/sessions, an expert's approval being revoked, or the
   *      account being deleted). Pages that never call the API on their own
   *      would never discover this. We periodically ping GET
   *      /api/auth/session — a cheap authenticated no-op that runs through
   *      the same revocation/idle check as every other route but does NOT
   *      reset the server's inactivity clock (see authMiddlewareNoTouch). We
   *      also check immediately on tab focus/visibility, which is what
   *      catches "admin terminates the session, then I switch back to that
   *      tab" without waiting for the next poll. apiFetch's global 401
   *      handler already clears storage and redirects on failure.
   *
   *   2. IDLE TIMEOUT — mirrors the server's 15-minute inactivity timeout on
   *      the client so the user gets logged out immediately when they've
   *      been idle that long, instead of only discovering it the next time
   *      they happen to click something and get a 401.
   *
   *   3. SILENT REFRESH — the access token only lives 15 minutes. Without
   *      this, even a continuously active user would be logged out every 15
   *      minutes. We exchange the refresh token for a new access token every
   *      10 minutes, but ONLY if the idle check says the user has actually
   *      been interacting recently — an abandoned tab won't keep refreshing
   *      itself forever. The 2-hour absolute session cap (sessions.expires_at
   *      server-side) still applies on top of this: once the refresh token
   *      itself expires, refresh attempts fail and the user is logged out
   *      regardless of activity.
   */
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const checkSession = () => {
      if (cancelled) return;
      apiFetch("/api/auth/session").catch(() => {
        // Network errors (e.g. briefly offline) are ignored here — only a
        // real 401 from the server should sign the user out, which apiFetch
        // already handles globally.
      });
    };

    const heartbeatId = setInterval(checkSession, HEARTBEAT_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkSession();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    globalThis.addEventListener("focus", checkSession);

    const idleAndRefreshId = setInterval(async () => {
      if (cancelled) return;

      const idleMs = Date.now() - (lastActivityRef.current ?? Date.now());

      if (idleMs >= INACTIVITY_TIMEOUT_MS) {
        // Client-side mirror of the server's idle timeout — log out right
        // away rather than waiting for some future request to 401. The
        // server independently enforces this on its own next touch-check
        // regardless, so this is a UX improvement, not the only enforcement.
        await logout();
        return;
      }

      // Recently active — keep the access token fresh.
      try {
        const refreshToken = sessionStorage.getItem(REFRESH_KEY);
        if (!refreshToken) return;

        const res = await apiFetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.token) {
          sessionStorage.setItem(STORAGE_KEY, data.token);
          setToken(data.token);
          setUser(decodeJwt(data.token));
        }
      } catch {
        // transient network failure — retry next tick
      }
    }, TOKEN_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeatId);
      clearInterval(idleAndRefreshId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener("focus", checkSession);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- logout is stable (useCallback([persist])) and persist is stable; re-running on token change is intentional.
  }, [token]);

  const value = useMemo(
    () => ({
      user, // { id, name, role } or null
      token,
      isAuthenticated: !!user,
      loading,
      error,
      login,
      logout,
    }),
    [user, token, loading, error, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}