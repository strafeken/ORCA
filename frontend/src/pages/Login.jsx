import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { OrcaWordmark } from "../components/Brand";

/**
 * Login page. Auth logic lives in AuthContext. This page also handles the
 * two-factor case: if the account has TOTP enabled, the first submit comes back
 * with `totpRequired`, and we reveal a 6-digit code field for the second submit.
 */
export default function Login() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [localError, setLocalError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    if (!email || !password) {
      setLocalError("Enter your email and password.");
      return;
    }
    try {
      await login(email, password, needTotp ? totp : undefined);
      navigate(from, { replace: true });
    } catch (err) {
      if (err.totpRequired) {
        // Reveal the code field and let the user submit again with the code.
        setNeedTotp(true);
        if (totp) setLocalError("Invalid code. Try again.");
      }
      // Other errors are surfaced via context `error`.
    }
  }

  const shownError = localError || error;

  function submitLabel() {
    if (loading) return "Signing in…";
    if (needTotp) return "Verify code";
    return "Sign in";
  }

  return (
    <div className="orca-login-split">
      <aside className="orca-login-brand">
        <OrcaWordmark size={32} />
        <div style={{ marginTop: "auto" }}>
          <p className="orca-code" style={{ color: "var(--orca-hi)", marginBottom: 14 }}>
            Secure consultation platform
          </p>
          <p style={s.brandLine}>
            Every session is access-controlled, encrypted in transit, and recorded for audit.
          </p>
        </div>
      </aside>

      <main style={s.formPane}>
        <div style={s.formCard}>
          <h1 style={s.h1}>Sign in</h1>
          <p style={s.sub}>Welcome back. Pick up where your team left off.</p>

          {shownError && (
            <div className="orca-alert" role="alert">
              {shownError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate autoComplete="off">
            <div className="orca-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                placeholder="you@orca.com"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={needTotp}
              />
            </div>

            <div className="orca-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Your password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={needTotp}
              />
            </div>

            {needTotp && (
              <div className="orca-field">
                <label htmlFor="totp">Authentication code</label>
                <input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  style={{ letterSpacing: "6px", textAlign: "center", fontSize: 20 }}
                />
              </div>
            )}

            <div style={s.row}>
              <Link to="/forgot-password" style={s.minor}>
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              className="orca-btn orca-btn--primary orca-btn--block"
              disabled={loading}
            >
              {submitLabel()}
            </button>
          </form>

          <p style={s.footNote}>
            New here? <Link to="/register">Create an account</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

const s = {
  brandLine: { fontSize: 22, lineHeight: 1.4, color: "var(--orca-ink)", maxWidth: 360, margin: 0 },
  formPane: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" },
  formCard: { width: "100%", maxWidth: 400 },
  h1: { fontSize: 34, fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 8px", color: "var(--orca-paper)" },
  sub: { fontSize: 16, color: "var(--orca-muted)", margin: "0 0 28px" },
  row: { display: "flex", justifyContent: "flex-end", marginBottom: 20 },
  minor: { fontSize: 14 },
  footNote: { fontSize: 15, color: "var(--orca-muted)", marginTop: 22, textAlign: "center" },
};
