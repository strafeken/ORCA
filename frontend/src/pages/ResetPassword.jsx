import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { OrcaWordmark } from "../components/Brand";
import { apiFetch } from "../auth/api";

/**
 * Reset-password page. The link in the reset email points here:
 *   /reset-password?token=...
 * The user sets a new password, which we send with the token to
 * POST /api/auth/reset-password.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!token) return setError("This reset link is missing its token.");
    if (password.length < 12) return setError("Password must be at least 12 characters.");
    if (password !== confirm) return setError("Passwords don't match.");

    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not reset password.");
      setDone(true);
      // Send them to login after a short beat.
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      setError(err.message);
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
              <h1 style={s.h1}>Password updated</h1>
              <p style={s.sub}>You can now sign in with your new password.</p>
              <Link to="/login" className="orca-btn orca-btn--primary orca-btn--block">
                Sign in
              </Link>
            </>
          ) : (
            <>
              <h1 style={s.h1}>Set a new password</h1>
              <p style={s.sub}>Choose a strong password of at least 12 characters.</p>
              {error && <div className="orca-alert" role="alert">{error}</div>}
              <form onSubmit={handleSubmit} noValidate autoComplete="off">
                <div className="orca-field">
                  <label htmlFor="password">New password</label>
                  <input
                    id="password"
                    type="password"
                    placeholder="At least 12 characters"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="orca-field">
                  <label htmlFor="confirm">Confirm password</label>
                  <input
                    id="confirm"
                    type="password"
                    placeholder="Re-enter password"
                    autoComplete="off"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="orca-btn orca-btn--primary orca-btn--block"
                  disabled={loading}
                >
                  {loading ? "Updating…" : "Update password"}
                </button>
              </form>
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
};
