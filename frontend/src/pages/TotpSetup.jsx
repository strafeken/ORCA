import { useState } from "react";
import { apiFetch } from "../auth/api";

/**
 * TOTP (2FA) setup page — for a logged-in user to enable two-factor auth.
 * Mounted inside the authenticated AppShell.
 *
 * Flow: click "Set up" -> backend returns a QR data-URL -> user scans it in an
 * authenticator app -> user enters a 6-digit code -> backend enables TOTP.
 */
export default function TotpSetup() {
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("idle"); // idle | setup | enabled
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function startSetup() {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/totp/setup", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start setup.");
      setQr(data.qr);
      setStatus("setup");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function enable(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/totp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Invalid code.");
      setStatus("enabled");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 460, margin: "0 auto" }}>
      <h1 style={s.h1}>Two-factor authentication</h1>
      <p style={s.sub}>
        Add an extra layer of security. You'll enter a code from your authenticator app each time
        you sign in.
      </p>

      {error && <div className="orca-alert" role="alert">{error}</div>}

      {status === "idle" && (
        <button onClick={startSetup} className="orca-btn orca-btn--primary" disabled={loading}>
          {loading ? "Starting…" : "Set up 2FA"}
        </button>
      )}

      {status === "setup" && (
        <div>
          <p style={s.step}>1. Scan this QR code in Google Authenticator, Authy, or similar:</p>
          {qr && (
            <img
              src={qr}
              alt="TOTP QR code"
              style={{ width: 200, height: 200, background: "#fff", padding: 8, borderRadius: 8 }}
            />
          )}
          <p style={s.step}>2. Enter the 6-digit code it shows:</p>
          <form onSubmit={enable}>
            <div className="orca-field">
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                style={{ letterSpacing: "6px", textAlign: "center", fontSize: 22 }}
              />
            </div>
            <button type="submit" className="orca-btn orca-btn--primary orca-btn--block" disabled={loading}>
              {loading ? "Verifying…" : "Enable 2FA"}
            </button>
          </form>
        </div>
      )}

      {status === "enabled" && (
        <div className="orca-alert" style={{ borderColor: "var(--orca-signal)", background: "rgba(61,214,140,0.1)", color: "#bfead3" }}>
          Two-factor authentication is now enabled. You'll be asked for a code next time you sign in.
        </div>
      )}
    </div>
  );
}

const s = {
  h1: { fontSize: 30, fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 10px", color: "var(--orca-paper)" },
  sub: { fontSize: 15, lineHeight: 1.5, color: "var(--orca-muted)", margin: "0 0 24px", maxWidth: 420 },
  step: { fontSize: 15, color: "var(--orca-ink)", margin: "20px 0 12px", fontWeight: 600 },
};
