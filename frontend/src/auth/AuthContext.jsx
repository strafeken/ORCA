import { useMemo, useState, useCallback } from "react";
import { AuthContext } from "./context";
import { apiFetch, STORAGE_KEY } from "./api";

/**
 * AuthContext — the single source of truth for "who is logged in".
 *
 * login() and logout() are wired to the real backend auth endpoints. The shape
 * of `user` ({ id, name, role }) is what the rest of the app expects.
 *
 * Token storage: keeps the access token in sessionStorage. The refresh token is
 * stored separately so logout can revoke the server session.
 */

const REFRESH_KEY = "orca.refresh";

// Decode a JWT payload without verifying it (display only — the server is the
// authority on every request; this is purely so the navbar can show a
// name/role before the first API round-trip).
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
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

  const persist = useCallback((newToken, refreshToken) => {
    if (newToken) {
      sessionStorage.setItem(STORAGE_KEY, newToken);
      if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
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
      if (refreshToken) {
        await apiFetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch {
      // ignore network errors on logout — still clear locally
    }
    persist(null);
  }, [persist]);

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
