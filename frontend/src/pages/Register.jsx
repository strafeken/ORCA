import { useState } from "react";
import { Link } from "react-router-dom";
import { OrcaWordmark } from "../components/Brand";
import { apiFetch, fetchCsrfToken } from "../auth/api";
import {
  validatePasswordLength,
  PASSWORD_PLACEHOLDER,
  isPasswordTooLong,
  passwordTooLongError,
} from "../auth/passwordPolicy";

/**
 * Register page — wired to POST /api/auth/register.
 *
 * On success the backend returns 202 with a generic message (it never reveals
 * whether the email was already taken). We show a success panel telling the
 * user what happens next based on the role they chose:
 *   - worker -> verify email
 *   - expert -> await admin approval
 */
export default function Register() {
  const [role, setRole] = useState("worker");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const passwordOverLimit = isPasswordTooLong(password);
  const displayError = error || (passwordOverLimit ? passwordTooLongError() : null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // Light client-side checks for fast feedback; the server validates too.
    if (!name.trim()) return setError("Please enter your name.");
    if (!email.trim()) return setError("Please enter your email.");
    const pwErr = validatePasswordLength(password);
    if (pwErr) return setError(pwErr);

    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'Invalid CSRF token') {
          await fetchCsrfToken();
          setError("Session refreshed — please try submitting again.");
          return;
        }
        throw new Error(data.error || "Registration failed. Please try again.");
      }
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Success panel
  if (done) {
    return (
      <div style={s.wrap}>
        <header style={s.top}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <OrcaWordmark />
          </Link>
        </header>
        <main style={s.center}>
          <div style={s.card}>
            <h1 style={s.h1}>Almost there</h1>
            {role === "worker" ? (
              <p style={s.sub}>
                If <strong>{email}</strong> isn't already registered, a verification link is on
                its way. Click the link in that email to activate your account, then sign in.
                Be sure to check your spam folder.
              </p>
            ) : (
              <p style={s.sub}>
                Your expert account has been created and is awaiting admin approval. You'll be
                able to sign in once an admin approves it.
              </p>
            )}
            <Link to="/login" className="orca-btn orca-btn--primary orca-btn--block">
              Go to sign in
            </Link>
          </div>
        </main>
      </div>
    );
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
          <h1 style={s.h1}>Create your account</h1>
          <p style={s.sub}>
            Workers are activated after email verification. Experts are reviewed by an admin
            before access is granted.
          </p>

          {displayError && (
            <div className="orca-alert" role="alert">
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate autoComplete="off">
            <div className="orca-field">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                type="text"
                placeholder="Jane Smith"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
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
            <div className="orca-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder={PASSWORD_PLACEHOLDER}
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={passwordOverLimit || undefined}
              />
            </div>

            <div className="orca-field">
              <span style={s.label} id="role-group-label">I am a…</span>
              <div style={s.roleRow} role="group" aria-labelledby="role-group-label">
                {["worker", "expert"].map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setRole(r)}
                    className="orca-btn"
                    style={{
                      flex: 1,
                      textTransform: "capitalize",
                      background: role === r ? "var(--orca-hi)" : "transparent",
                      color: role === r ? "var(--orca-abyss)" : "var(--orca-ink)",
                      border: `1px solid ${role === r ? "var(--orca-hi)" : "var(--orca-line)"}`,
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="orca-btn orca-btn--primary orca-btn--block"
              disabled={loading || passwordOverLimit}
            >
              {loading ? "Creating…" : "Create account"}
            </button>
          </form>

          <p style={s.footNote}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
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
  roleRow: { display: "flex", gap: 12 },
  footNote: { fontSize: 15, color: "var(--orca-muted)", marginTop: 22, textAlign: "center" },
};
