import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../auth/api";
import { useAuth } from "../auth/useAuth";

export default function DeleteAccount() {
  const [step, setStep] = useState("reauth"); // "reauth" | "confirm"
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();


  async function handleReauth(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/users/me/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: currentPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Incorrect password.");
      setStep("confirm");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/users/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: currentPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete account.");

      await logout();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      <Link to="/profile?tab=data" style={s.backLink}>
        ← Back to Data &amp; privacy
      </Link>
      <h1 style={s.h1}>Delete account</h1>

      {step === "reauth" && (
        <form onSubmit={handleReauth}>
          <p style={{ ...s.sub, marginBottom: 16 }}>
            Confirm your password to continue to account deletion.
          </p>
          <div style={s.field}>
            <label style={s.label} htmlFor="delete-current-password">Current password</label>
            <input
              id="delete-current-password"
              type="password"
              style={s.input}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p style={{ color: "var(--orca-danger, #e05a5a)", fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={submitting} className="orca-btn orca-btn--ghost" style={{ marginTop: 8 }}>
            {submitting ? "Checking…" : "Continue"}
          </button>
        </form>
      )}

      {step === "confirm" && (
        <div style={s.card}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--orca-ink)", margin: "0 0 8px" }}>
            Delete your account?
          </h2>
          <p style={{ ...s.sub, marginBottom: 20 }}>
            This permanently deletes your account and cannot be undone.
          </p>
          {error && <p style={{ color: "var(--orca-danger, #e05a5a)", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleDelete}
              disabled={submitting}
              style={{
                background: "transparent",
                color: "var(--orca-danger, #e05a5a)",
                border: "1px solid var(--orca-danger, #e05a5a)",
                borderRadius: 8,
                padding: "10px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {submitting ? "Deleting…" : "Delete Account"}
            </button>
            <button onClick={() => setStep("reauth")} disabled={submitting} className="orca-btn orca-btn--ghost">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  h1: { fontSize: 30, fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 10px", color: "var(--orca-paper)" },
  sub: { fontSize: 15, color: "var(--orca-muted)" },
  backLink: {
    display: "inline-block",
    color: "var(--orca-hi)",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    marginBottom: 16,
  },
  field: { marginBottom: 16 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "var(--orca-muted)", marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    fontSize: 14,
    fontFamily: "inherit",
  },
  card: {
    border: "1px solid var(--orca-line)",
    borderRadius: "var(--orca-radius)",
    background: "var(--orca-slate)",
    padding: 20,
  },
};