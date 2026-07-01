import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

/**
 * Dashboard — home after login.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const isWorker = user?.role === "worker";
  const isExpert = user?.role === "expert";
  const isAdmin = user?.role === "admin";

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <p className="orca-code" style={{ color: "var(--orca-hi)" }}>
        Signed in as {user?.role}
      </p>
      <h1 style={s.h1}>Hi {user?.name?.split(" ")[0]}.</h1>
      <p style={s.sub}>
        {isWorker && "Browse experts or open Consult to message and video call when someone is online."}
        {isExpert && "Workers reach out via Consult — reply and start a video call when they are online."}
        {isAdmin && "Use the admin console to manage users, sessions, and audit logs."}
      </p>

      <div style={s.grid}>
        {isWorker && (
          <>
            <Link to="/experts" style={s.card}>
              <span className="orca-code" style={{ color: "var(--orca-hi)", display: "block", marginBottom: 14 }}>DIRECTORY</span>
              <h3 style={s.cardTitle}>Expert directory</h3>
              <p style={s.cardBody}>Browse all verified experts by specialty and background.</p>
            </Link>
            <Link to="/consult" style={s.card}>
              <span className="orca-code" style={{ color: "var(--orca-hi)", display: "block", marginBottom: 14 }}>CONSULT</span>
              <h3 style={s.cardTitle}>Consult an expert</h3>
              <p style={s.cardBody}>Your conversations, new experts, messages, and video calls in one place.</p>
            </Link>
          </>
        )}
        {isExpert && (
          <Link to="/consult" style={s.card}>
            <span className="orca-code" style={{ color: "var(--orca-hi)", display: "block", marginBottom: 14 }}>CONSULT</span>
            <h3 style={s.cardTitle}>Worker requests</h3>
            <p style={s.cardBody}>Message and video call with workers who need your help.</p>
          </Link>
        )}
        {isAdmin && (
          <Link to="/adm/managementDashboard" style={s.card}>
            <span className="orca-code" style={{ color: "var(--orca-hi)", display: "block", marginBottom: 14 }}>ADMIN</span>
            <h3 style={s.cardTitle}>Admin console</h3>
            <p style={s.cardBody}>Approvals, sessions, audit, and chat-log control.</p>
          </Link>
        )}
      </div>
    </div>
  );
}

const s = {
  h1: { fontSize: 38, fontWeight: 700, letterSpacing: "-1px", margin: "10px 0 12px", color: "var(--orca-paper)" },
  sub: { fontSize: 16, lineHeight: 1.55, color: "var(--orca-muted)", margin: "0 0 32px", maxWidth: 620 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 },
  card: {
    display: "block",
    padding: 22,
    borderRadius: "var(--orca-radius)",
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    textDecoration: "none",
    transition: "border-color 0.15s ease",
  },
  cardTitle: { fontSize: 19, fontWeight: 600, margin: "0 0 6px", color: "var(--orca-ink)" },
  cardBody: { fontSize: 14, lineHeight: 1.5, color: "var(--orca-muted)", margin: 0 },
};
