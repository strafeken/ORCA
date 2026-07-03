import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../auth/api";

export default function PasswordChange() {
  const [step, setStep] = useState("reauth"); // "reauth" | "change"
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

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
      setStep("change");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to change password.");
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "0 auto" }}>
      <Link to="/profile?tab=security" style={s.backLink}>
        ← Back to Security
      </Link>
      <h1 style={s.h1}>Change password</h1>

      {done && <p style={{ color: "var(--orca-hi)", fontSize: 14 }}>Your password has been changed.</p>}

      {!done && step === "reauth" && (
        <form onSubmit={handleReauth}>
          <p style={{ ...s.sub, marginBottom: 16 }}>Confirm your current password to continue.</p>
          <div style={s.field}>
            <label style={s.label}>Current password</label>
            <input
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

      {!done && step === "change" && (
        <form onSubmit={handleChangePassword}>
          <div style={s.field}>
            <label style={s.label}>New password</label>
            <input
              type="password"
              style={s.input}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div style={s.field}>
            <label style={s.label}>Confirm new password</label>
            <input
              type="password"
              style={s.input}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p style={{ color: "var(--orca-danger, #e05a5a)", fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={submitting} className="orca-btn orca-btn--ghost" style={{ marginTop: 8 }}>
            {submitting ? "Saving…" : "Change password"}
          </button>
        </form>
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
};