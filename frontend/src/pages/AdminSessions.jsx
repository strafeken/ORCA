import { useEffect, useState, useMemo, useCallback } from "react";
import { apiFetch } from "../auth/api";
import { pluralSuffix } from "../utils/text";

function formatAgent(ua) {
  if (!ua) return "—";
  return ua.length > 60 ? ua.slice(0, 60) + "…" : ua;
}

function timeUntil(expires, now) {
  const diff = new Date(expires) - now;
  if (diff <= 0) return "expired";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function timeIdle(lastActivity, now) {
  if (!lastActivity) return "—";
  const diff = now - new Date(lastActivity);
  if (diff < 30_000) return "just now";
  const m = Math.floor(diff / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s ago` : `${s}s ago`;
}

function idleWarnColor(lastActivity, now) {
  if (!lastActivity) return "var(--orca-muted)";
  const idleMs = now - new Date(lastActivity);
  return idleMs > 10 * 60 * 1000 ? "#d97706" : "var(--orca-muted)";
}

/**
 * AdminSessions — mounted at /adm/sessions.
 *
 * Lists every non-revoked, non-expired session across ALL users so admins can:
 *   - See who is currently logged in and from where (source IP, user-agent).
 *   - Terminate any suspicious or stale session immediately. (SR-23)
 *
 * Session termination is done by revoking the row server-side. The affected
 * user's next request will receive a 401 and be logged out automatically.
 */
export default function AdminSessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [search, setSearch]     = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const [confirm, setConfirm]     = useState(null); // session to terminate
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback]   = useState(null);

  // `now` drives the relative "expires in" / "idle for" columns. Reading
  // Date.now() directly during render is impure (react-hooks/purity) since
  // it makes the component's output depend on something outside props/state.
  // Instead we keep a `now` value in state and refresh it on an interval —
  // this is itself an effect's job (subscribing to the passage of time is a
  // legitimate external-system sync), so the setState call inside it happens
  // from a timer callback, not synchronously in the effect body.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // See AdminUserManagement.jsx for the rationale: `loading` starts true so
  // the mount effect never needs a synchronous setLoading(true) call, only
  // the async setLoading(false) in .finally(), which is not flagged by
  // react-hooks/set-state-in-effect.
  const fetchSessions = useCallback(() => {
    return apiFetch("/api/admin/sessions")
      .then((r) => r.json())
      .then((d) => { setSessions(d.sessions || []); setError(null); setLastFetched(new Date()); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Used by the Refresh button (event handler — not subject to the rule).
  function loadSessions() {
    setLoading(true);
    fetchSessions();
  }

  // ── Filter ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...sessions];
    if (roleFilter !== "all") result = result.filter((s) => s.role === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          (s.source_ip || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [sessions, roleFilter, search]);

  // ── Terminate ─────────────────────────────────────────────────────────
  async function terminateSession() {
    if (!confirm) return;
    setActionLoading(true);
    try {
      const res  = await apiFetch(`/api/admin/sessions/${confirm.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to terminate session.");
      setFeedback({ ok: true, text: `Session for ${confirm.name} terminated.` });
      loadSessions();
    } catch (e) {
      setFeedback({ ok: false, text: e.message });
    } finally {
      setActionLoading(false);
      setConfirm(null);
    }
  }

  const ROLE_COLORS = { worker: "#60a5fa", expert: "#a78bfa", admin: "#f472b6" };

  function renderSessionRows() {
    if (loading) {
      return <tr><td colSpan={8} style={s.empty}>Loading sessions…</td></tr>;
    }
    if (filtered.length === 0) {
      return <tr><td colSpan={8} style={s.empty}>No active sessions.</td></tr>;
    }
    return filtered.map((sess) => (
      <tr key={sess.id}>
        <td style={s.td}>
          <span style={s.name}>{sess.name}</span>
          <br />
          <span style={s.email}>{sess.email}</span>
        </td>
        <td style={s.td}>
          <span style={{ ...s.badge, color: ROLE_COLORS[sess.role] || "#94a3b8" }}>
            {sess.role}
          </span>
        </td>
        <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12 }}>
          {sess.source_ip || "—"}
        </td>
        <td style={{ ...s.td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 11, color: "var(--orca-muted)" }} title={sess.user_agent}>
          {formatAgent(sess.user_agent)}
        </td>
        <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12, color: "var(--orca-muted)" }}>
          {new Date(sess.created_at).toLocaleString()}
        </td>
        <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12, color: idleWarnColor(sess.last_activity, now) }}>
          {timeIdle(sess.last_activity, now)}
        </td>
        <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12 }}>
          {timeUntil(sess.expires_at, now)}
        </td>
        <td style={{ ...s.td, textAlign: "right" }}>
          <button style={s.terminateBtn} onClick={() => setConfirm(sess)}>
            Terminate
          </button>
        </td>
      </tr>
    ));
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Active Sessions</h1>
          <p style={s.subtitle}>{sessions.length} live session{pluralSuffix(sessions.length)}</p>
        </div>
        <div style={s.headerRight}>
          {lastFetched && (
            <span style={s.lastFetched}>
              Last fetched {lastFetched.toLocaleTimeString(undefined, { hour12: false })}
            </span>
          )}
          <button style={s.refreshBtn} onClick={loadSessions} disabled={loading}>
            {loading ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {feedback && (
        <div style={{ ...s.banner, background: feedback.ok ? "#052e16" : "#450a0a", color: feedback.ok ? "#86efac" : "#fca5a5", border: `1px solid ${feedback.ok ? "#166534" : "#991b1b"}` }}>
          {feedback.text}
          <button style={s.bannerClose} onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      {error && (
        <div style={{ ...s.banner, background: "#450a0a", color: "#fca5a5", border: "1px solid #991b1b" }}>
          {error}
        </div>
      )}

      {/* ── Filters ── */}
      <div style={s.filters}>
        <input
          style={s.searchInput}
          placeholder="Search name, email or IP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={s.select} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          <option value="worker">Worker</option>
          <option value="expert">Expert</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {/* ── Table ── */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>User</th>
              <th style={s.th}>Role</th>
              <th style={s.th}>Source IP</th>
              <th style={s.th}>User-Agent</th>
              <th style={s.th}>Started</th>
              <th style={s.th}>Idle</th>
              <th style={s.th}>Expires in</th>
              <th style={{ ...s.th, textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {renderSessionRows()}
          </tbody>
        </table>
      </div>

      <p style={s.count}>Showing {filtered.length} of {sessions.length} sessions</p>

      {/* ── Confirm dialog ── */}
      {confirm && (
        <div style={s.overlay}>
          <div style={s.dialog}>
            <h2 style={s.dialogTitle}>Terminate session?</h2>
            <p style={s.dialogBody}>
              This will immediately revoke the session for <strong>{confirm.name}</strong>
              {confirm.source_ip ? ` (from ${confirm.source_ip})` : ""}. Their next request
              will be rejected and they will be logged out.
            </p>
            <div style={s.dialogBtns}>
              <button style={s.cancelBtn} onClick={() => setConfirm(null)} disabled={actionLoading}>
                Cancel
              </button>
              <button style={s.confirmBtn} onClick={terminateSession} disabled={actionLoading}>
                {actionLoading ? "Terminating…" : "Terminate session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  page: { maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 700, margin: "0 0 4px" },
  subtitle: { fontSize: 13, color: "var(--orca-muted)", margin: 0 },
  headerRight: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  lastFetched: { fontSize: 11, color: "var(--orca-muted)" },
  refreshBtn: { fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", cursor: "pointer" },
  banner: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 14 },
  bannerClose: { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "inherit" },
  filters: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  searchInput: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", width: 260 },
  select: { fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)" },
  tableWrap: { border: "1px solid var(--orca-line)", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "9px 14px", fontSize: 11, fontWeight: 500, color: "var(--orca-muted)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--orca-line)", background: "var(--orca-slate)" },
  td: { padding: "10px 14px", borderBottom: "1px solid var(--orca-line)", verticalAlign: "middle" },
  name: { fontWeight: 500, color: "var(--orca-ink)" },
  email: { fontSize: 12, color: "var(--orca-muted)", fontFamily: "monospace" },
  badge: { fontSize: 11, fontWeight: 600 },
  empty: { padding: "2rem", textAlign: "center", color: "var(--orca-muted)" },
  count: { fontSize: 12, color: "var(--orca-muted)", marginTop: 10, textAlign: "right" },
  terminateBtn: { fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #dc2626", background: "transparent", color: "#f87171", cursor: "pointer", fontWeight: 500 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  dialog: { background: "var(--orca-slate)", border: "1px solid var(--orca-line)", borderRadius: 14, padding: "28px 32px", maxWidth: 420, width: "90%" },
  dialogTitle: { fontSize: 17, fontWeight: 700, margin: "0 0 10px" },
  dialogBody: { fontSize: 14, color: "var(--orca-muted)", margin: "0 0 24px", lineHeight: 1.55 },
  dialogBtns: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "transparent", color: "var(--orca-ink)", cursor: "pointer" },
  confirmBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontWeight: 600 },
};