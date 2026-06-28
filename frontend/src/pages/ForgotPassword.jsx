import { useState } from "react";
import { Link } from "react-router-dom";
import { OrcaWordmark } from "../components/Brand";
import { apiFetch } from "../auth/api";

/**
 * Forgot-password page. Submits an email to POST /api/auth/forgot-password.
 * The backend always returns a generic message (anti-enumeration), so we show
 * the same confirmation whether or not the email exists.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError("Please enter your email.");
    setLoading(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always show success — backend response is intentionally generic.
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.wrap}>
      <header style={s.top}>
        <Link to="/" style={{ textDecoration: "none" }}>
          <OrcaWordmark />
        </Link>
      </header>
      <main style={s.center}>
        <div style={s.card}>
          {done ? (
            <>
              <h1 style={s.h1}>Check your email</h1>
              <p style={s.sub}>
                If an account exists for <strong>{email}</strong>, a password reset link has been
                sent. The link expires in 1 hour.
              </p>
              <Link to="/login" className="orca-btn orca-btn--primary orca-btn--block">
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 style={s.h1}>Reset your password</h1>
              <p style={s.sub}>Enter your email and we'll send you a reset link.</p>
              {error && <div className="orca-alert" role="alert">{error}</div>}
              <form onSubmit={handleSubmit} noValidate>
                <div className="orca-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@orca.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="orca-btn orca-btn--primary orca-btn--block"
                  disabled={loading}
                >
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
              <p style={s.footNote}>
                Remembered it? <Link to="/login">Sign in</Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const s = {
  wrap: { minHeight: "100svh", display: "flex", flexDirection: "column" },
  top: { padding: "20px clamp(20px,5vw,64px)", borderBottom: "1px solid var(--orca-line)" },
  center: { flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" },
  card: { width: "100%", maxWidth: 420 },
  h1: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 10px", color: "var(--orca-paper)" },
  sub: { fontSize: 15, lineHeight: 1.5, color: "var(--orca-muted)", margin: "0 0 26px" },
  footNote: { fontSize: 15, color: "var(--orca-muted)", marginTop: 22, textAlign: "center" },
};
