import { useState } from "react";
import { apiFetch, fetchCsrfToken, STORAGE_KEY, REFRESH_KEY } from "../auth/api";
import { OrcaWordmark } from "../components/Brand";

/**
 * AdminLogin — mounted at /adm/administratorLogin.
 *
 * This page is completely separate from the regular /login so that:
 *   - Admins and regular users cannot be confused at the door.
 *   - The admin endpoint (POST /api/auth/admin/login) receives a stricter
 *     rate limit and rejects non-admin credentials entirely.
 *   - The URL is obscure-by-design; this is not security through obscurity
 *     (real security lives in RBAC server-side) but removes admin from the
 *     main login surface.
 *
 * On success this page stores the tokens in sessionStorage under the same keys
 * the AuthContext uses, then does a hard redirect to /admin so AuthContext
 * re-reads the stored token and hydrates the session correctly.
 */

export default function AdminLogin() {
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [totp, setTotp]             = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError]           = useState(null);
  const [loading, setLoading]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(totp ? { totp } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.totpRequired) {
          setTotpRequired(true);
          setError("Enter your 6-digit authenticator code below.");
        } else {
          setError(data.error || "Email or password is incorrect.");
        }
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, data.token);
      if (data.refreshToken) {
        sessionStorage.setItem(REFRESH_KEY, data.refreshToken);
      }
      // Rebind the CSRF token to the new refresh-token identity (forced so it
      // can't reuse an in-flight anonymous-bound fetch).
      await fetchCsrfToken({ force: true });
      globalThis.location.replace("/adm/managementDashboard");
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Brand + portal badge */}
        <div style={s.brand}>
          <OrcaWordmark size={26} />
          <span style={s.portalBadge}>Admin Portal</span>
        </div>

        <h1 style={s.title}>Administrator sign-in</h1>
        <p style={s.subtitle}>
          This portal is restricted to authorised ORCA administrators only.
        </p>

        {error && (
          <div role="alert" style={s.errorBox}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={s.form} noValidate autoComplete="off">
          <label style={s.label} htmlFor="adm-email">
            Email address
          </label>
          <input
            id="adm-email"
            style={s.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            disabled={loading}
          />

          <label style={s.label} htmlFor="adm-password">
            Password
          </label>
          <input
            id="adm-password"
            style={s.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            required
            disabled={loading}
          />

          {/* TOTP step — shown only after the server indicates 2FA is needed */}
          {totpRequired && (
            <>
              <label style={s.label} htmlFor="adm-totp">
                Authenticator code
              </label>
              <input
                id="adm-totp"
                style={s.input}
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="6-digit code"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </>
          )}

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p style={s.footer}>
          Not an administrator?{" "}
          <a href="/login" style={s.link}>
            Go to main login →
          </a>
        </p>
      </div>
    </div>
  );
}

// Dark theme so this page is visually distinct from the regular login.
const s = {
  page: {
    minHeight: "100svh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0d0f15",
    padding: "24px",
    fontFamily: "sans-serif",
  },
  card: {
    background: "#16192a",
    border: "1px solid #252840",
    borderRadius: 16,
    padding: "40px 44px",
    width: "100%",
    maxWidth: 420,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  portalBadge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    background: "#2e1d5e",
    color: "#b39ddb",
    padding: "3px 9px",
    borderRadius: 4,
    border: "1px solid #4a3270",
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: "#eaeaf0",
    margin: "0 0 6px",
  },
  subtitle: {
    fontSize: 13,
    color: "#5c607a",
    margin: "0 0 24px",
    lineHeight: 1.5,
  },
  errorBox: {
    background: "#2d1515",
    border: "1px solid #5c2020",
    color: "#f87171",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 1.5,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: "#7c80a0",
    marginTop: 12,
    marginBottom: 5,
    letterSpacing: "0.01em",
  },
  input: {
    fontSize: 14,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #252840",
    background: "#0d0f15",
    color: "#eaeaf0",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  btn: {
    marginTop: 22,
    padding: "11px 0",
    borderRadius: 8,
    border: "none",
    background: "#5c35c7",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    letterSpacing: "0.01em",
  },
  footer: {
    marginTop: 22,
    fontSize: 12,
    color: "#5c607a",
    textAlign: "center",
  },
  link: {
    color: "#9575cd",
    textDecoration: "none",
  },
};