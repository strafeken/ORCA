import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OrcaWordmark } from "../components/Brand";
import { apiFetch } from "../auth/api";

/**
 * Verify-email landing page. The link in the verification email points here:
 *   /verify-email?token=...
 * On mount we read the token from the URL and call the backend to confirm it.
 */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState(token ? "verifying" : "error");
  const [message, setMessage] = useState(
    token ? "" : "No verification token found in the link."
  );

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setMessage(data.error || "This verification link is invalid or has expired.");
        } else {
          setStatus("success");
          setMessage(data.message || "Email verified. You can now log in.");
        }
      } catch {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      }
    })();
  }, [token]);

  return (
    <div style={s.wrap}>
      <header style={s.top}>
        <Link to="/" style={{ textDecoration: "none" }}>
          <OrcaWordmark />
        </Link>
      </header>
      <main style={s.center}>
        <div style={s.card}>
          {status === "verifying" && <h1 style={s.h1}>Verifying…</h1>}
          {status === "success" && (
            <>
              <h1 style={s.h1}>Email verified</h1>
              <p style={s.sub}>{message}</p>
              <Link to="/login" className="orca-btn orca-btn--primary orca-btn--block">
                Sign in
              </Link>
            </>
          )}
          {status === "error" && (
            <>
              <h1 style={s.h1}>Verification failed</h1>
              <p style={s.sub}>{message}</p>
              <Link to="/login" className="orca-btn orca-btn--ghost orca-btn--block">
                Back to sign in
              </Link>
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
  card: { width: "100%", maxWidth: 420, textAlign: "center" },
  h1: { fontSize: 30, fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 12px", color: "var(--orca-paper)" },
  sub: { fontSize: 15, lineHeight: 1.5, color: "var(--orca-muted)", margin: "0 0 26px" },
};
