import { useEffect, useState, useMemo, useCallback } from "react";
import { apiFetch } from "../auth/api";

/**
 * AdminUserManagement — mounted at /adm/users.
 *
 * Lists every user account with status badges and per-row actions:
 *   - Delete account (soft-delete, PII anonymised, logs retained — FR-05, SR-27)
 *   - Approve / revoke Expert access (FR-02, SR-09)
 *   - Unlock a hard-locked account (SR-22)
 *
 * All mutating actions require an explicit confirmation dialog before they
 * are sent to the backend, and the table refreshes automatically after each
 * successful action.
 *
 * FIX: MySQL BOOLEAN columns (is_hard_locked, is_soft_locked, is_verified,
 * is_approved) are returned as integers 0 / 1, not JS booleans. Using them
 * directly in JSX short-circuit expressions like {0 && <Btn/>} renders a
 * literal "0" to the DOM. All such expressions now coerce with !! so the
 * value is always a proper boolean before JSX evaluates it.
 */
export default function AdminUserManagement() {
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  // "active" | "deleted" — deleted (PII-anonymised tombstone) accounts live on
  // their own tab so they don't clog the active-users table.
  const [tab, setTab] = useState("active");

  // { type: 'delete'|'approve'|'revoke'|'unlock', user }
  const [confirm, setConfirm] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  // `loading` starts true so the initial fetch on mount never needs to call
  // setLoading(true) synchronously inside the effect body — only the async
  // .finally(() => setLoading(false)) fires, which the set-state-in-effect
  // rule does not flag (state updates from resolved promises/callbacks are
  // fine; only *synchronous* setState calls in the effect body itself are
  // the rule's target). The refresh button's onClick is what re-arms the
  // spinner for manual refreshes, since event handlers aren't covered by
  // this rule either.
  const fetchUsers = useCallback(() => {
    return apiFetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setError(null); setLastFetched(new Date()); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Used by the Refresh button — an event handler, so setLoading(true) here
  // is not subject to react-hooks/set-state-in-effect.
  function loadUsers() {
    setLoading(true);
    fetchUsers();
  }

  // ── Partition into active vs deleted accounts ────────────────────────
  const isDeleted = (u) => u.email.endsWith("@orca-deleted");
  const activeUsers  = useMemo(() => users.filter((u) => !isDeleted(u)), [users]);
  const deletedUsers = useMemo(() => users.filter(isDeleted), [users]);

  // ── Filtering (scoped to the current tab) ────────────────────────────
  const filtered = useMemo(() => {
    let result = tab === "deleted" ? [...deletedUsers] : [...activeUsers];
    if (roleFilter !== "all") result = result.filter((u) => u.role === roleFilter);
    // Status filters only apply to active accounts; deleted tombstones have no
    // meaningful lock/verification state to filter on.
    if (tab === "active") {
      if (statusFilter === "hard_locked")     result = result.filter((u) => !!u.is_hard_locked);
      if (statusFilter === "pending_expert")  result = result.filter((u) => u.role === "expert" && !u.is_approved);
      if (statusFilter === "unverified")      result = result.filter((u) => !u.is_verified);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      );
    }
    return result;
  }, [activeUsers, deletedUsers, tab, roleFilter, statusFilter, search]);

  // Switching tabs is a user action, so reset the status filter here (in the
  // handler) rather than in an effect — the status filter is active-tab-only.
  function handleTabChange(nextTab) {
    setTab(nextTab);
    setStatusFilter("all");
  }

  // ── Actions ──────────────────────────────────────────────────────────
  async function executeAction() {
    if (!confirm) return;
    setActionLoading(true);
    setActionMsg(null);

    const { type, user } = confirm;
    let url, opts;

    if (type === "delete") {
      url  = `/api/admin/users/${user.id}`;
      opts = { method: "DELETE" };
    } else if (type === "approve") {
      url  = `/api/admin/users/${user.id}/approve`;
      opts = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) };
    } else if (type === "revoke") {
      url  = `/api/admin/users/${user.id}/approve`;
      opts = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: false }) };
    } else if (type === "unlock") {
      url  = `/api/admin/users/${user.id}/unlock`;
      opts = { method: "PATCH" };
    }

    try {
      const res  = await apiFetch(url, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed.");
      setActionMsg({ ok: true, text: data.message });
      loadUsers();
    } catch (e) {
      setActionMsg({ ok: false, text: e.message });
    } finally {
      setActionLoading(false);
      setConfirm(null);
    }
  }

  // ── Status badges ────────────────────────────────────────────────────
  function statusBadges(u) {
    // Deleted accounts (PII-anonymised by the backend) get a single badge
    // and nothing else — their lock/verified state is an implementation
    // detail of the soft-delete, not meaningful to show.
    if (u.email.endsWith("@orca-deleted")) {
      return [{ label: "Deleted", color: "#94a3b8", bg: "#1e293b" }];
    }

    const badges = [];
    // Coerce MySQL 0/1 integers to booleans before branching.
    const hardLocked = !!u.is_hard_locked;
    const softLocked = !!u.is_soft_locked;
    const verified   = !!u.is_verified;
    const approved   = !!u.is_approved;

    if (hardLocked)                           badges.push({ label: "Hard locked", color: "#fca5a5", bg: "#450a0a" });
    else if (softLocked)                      badges.push({ label: "Soft locked", color: "#fcd34d", bg: "#422006" });
    if (!verified)                            badges.push({ label: "Unverified",  color: "#94a3b8", bg: "#1e293b" });
    if (u.role === "expert" && !approved)     badges.push({ label: "Pending",     color: "#fdba74", bg: "#431407" });
    if (u.role === "expert" && approved)      badges.push({ label: "Approved",    color: "#86efac", bg: "#052e16" });
    return badges;
  }

  const ROLE_COLORS = { worker: "#60a5fa", expert: "#a78bfa", admin: "#f472b6" };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>User Management</h1>
          <p style={s.subtitle}>{users.length} total accounts</p>
        </div>
        <div style={s.headerRight}>
          {lastFetched && (
            <span style={s.lastFetched}>
              Last fetched {lastFetched.toLocaleTimeString(undefined, { hour12: false })}
            </span>
          )}
          <button style={s.refreshBtn} onClick={loadUsers} disabled={loading}>
            {loading ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Feedback banner ── */}
      {actionMsg && (
        <div style={{ ...s.banner, background: actionMsg.ok ? "#052e16" : "#450a0a", color: actionMsg.ok ? "#86efac" : "#fca5a5", border: `1px solid ${actionMsg.ok ? "#166534" : "#991b1b"}` }}>
          {actionMsg.text}
          <button style={s.bannerClose} onClick={() => setActionMsg(null)}>✕</button>
        </div>
      )}

      {error && <div style={{ ...s.banner, background: "#450a0a", color: "#fca5a5", border: "1px solid #991b1b" }}>{error}</div>}

      {/* ── Tab bar: active vs deleted accounts ── */}
      <div style={s.tabBar}>
        {[
          { key: "active",  label: `Active users (${activeUsers.length})` },
          { key: "deleted", label: `Deleted users (${deletedUsers.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            style={{ ...s.tab, ...(tab === key ? s.tabActive : {}) }}
            onClick={() => handleTabChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={s.filters}>
        <input
          style={s.searchInput}
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={s.select} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          <option value="worker">Worker</option>
          <option value="expert">Expert</option>
          <option value="admin">Admin</option>
        </select>
        {/* Status filters are meaningful only for active accounts. */}
        {tab === "active" && (
          <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="hard_locked">Hard locked</option>
            <option value="pending_expert">Pending expert approval</option>
            <option value="unverified">Unverified</option>
          </select>
        )}
      </div>

      {/* ── Table ── */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Name / Email</th>
              <th style={s.th}>Role</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Failures</th>
              <th style={s.th}>Joined</th>
              <th style={{ ...s.th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={s.empty}>Loading users…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={s.empty}>
                {tab === "deleted" && deletedUsers.length === 0
                  ? "No deleted accounts."
                  : "No users match your filters."}
              </td></tr>
            ) : filtered.map((u) => {
              // Coerce MySQL 0/1 integers to real booleans once per row.
              // Without this, JSX expressions like {0 && <Btn/>} render a
              // literal "0" character into the DOM instead of nothing.
              const hardLocked = !!u.is_hard_locked;
              const approved   = !!u.is_approved;
              const isDeleted  = u.email.endsWith("@orca-deleted");

              // Deleted rows are muted; hard-locked (live) rows get the red
              // tint. Deleted takes priority over all other row styles.
              const rowStyle = isDeleted
                ? { opacity: 0.5 }
                : hardLocked
                ? { background: "#1c0a0a" }
                : {};

              return (
                <tr key={u.id} style={rowStyle}>
                  <td style={s.td}>
                    <span style={s.name}>{u.name}</span>
                    <br />
                    <span style={s.email}>{u.email}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, color: ROLE_COLORS[u.role] || "#94a3b8", background: "#1e293b", border: "1px solid #334155" }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {statusBadges(u).map((b) => (
                        <span key={b.label} style={{ ...s.badge, color: b.color, background: b.bg, border: "none" }}>
                          {b.label}
                        </span>
                      ))}
                      {statusBadges(u).length === 0 && (
                        <span style={{ ...s.badge, color: "#86efac", background: "#052e16" }}>Active</span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...s.td, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                    {u.failed_attempts}
                  </td>
                  <td style={{ ...s.td, color: "var(--orca-muted)", fontSize: 12, fontFamily: "monospace" }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ ...s.td, textAlign: "right" }}>
                    {/* Deleted accounts (PII-anonymised tombstone rows) have no
                        recoverable state — suppress every action button. The
                        hard-lock they carry is an implementation detail of the
                        soft-delete, not an admin-resettable lock. */}
                    {isDeleted ? (
                      <span style={s.deletedNote}>account removed</span>
                    ) : (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {/* Unlock — only for live hard-locked accounts */}
                        {hardLocked && (
                          <ActionBtn label="Unlock" color="#60a5fa" onClick={() => setConfirm({ type: "unlock", user: u })} />
                        )}
                        {/* Expert approval buttons */}
                        {u.role === "expert" && !approved && (
                          <ActionBtn label="Approve" color="#86efac" onClick={() => setConfirm({ type: "approve", user: u })} />
                        )}
                        {u.role === "expert" && approved && (
                          <ActionBtn label="Revoke" color="#fdba74" onClick={() => setConfirm({ type: "revoke", user: u })} />
                        )}
                        {/* Delete — not available for admin accounts */}
                        {u.role !== "admin" && (
                          <ActionBtn label="Delete" color="#f87171" onClick={() => setConfirm({ type: "delete", user: u })} />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={s.count}>
        Showing {filtered.length} of {tab === "deleted" ? deletedUsers.length : activeUsers.length} {tab} accounts
      </p>

      {/* ── Confirm dialog ── */}
      {confirm && (
        <div style={s.overlay}>
          <div style={s.dialog}>
            <h2 style={s.dialogTitle}>{CONFIRM_COPY[confirm.type].title}</h2>
            <p style={s.dialogBody}>
              {CONFIRM_COPY[confirm.type].body(confirm.user.name)}
            </p>
            <div style={s.dialogBtns}>
              <button style={s.cancelBtn} onClick={() => setConfirm(null)} disabled={actionLoading}>
                Cancel
              </button>
              <button
                style={{ ...s.confirmBtn, background: CONFIRM_COPY[confirm.type].btnColor }}
                onClick={executeAction}
                disabled={actionLoading}
              >
                {actionLoading ? "Working…" : CONFIRM_COPY[confirm.type].btnLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, color, onClick }) {
  return (
    <button
      style={{
        fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
        border: `1px solid ${color}`, background: "transparent", color,
        fontWeight: 500,
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const CONFIRM_COPY = {
  delete: {
    title:    "Delete account",
    body:     (name) => `Delete "${name}"? Their conversation logs will be retained for audit purposes. This action cannot be undone.`,
    btnLabel: "Delete account",
    btnColor: "#dc2626",
  },
  approve: {
    title:    "Approve Expert",
    body:     (name) => `Grant platform access to Expert "${name}"?`,
    btnLabel: "Approve",
    btnColor: "#16a34a",
  },
  revoke: {
    title:    "Revoke Expert approval",
    body:     (name) => `Revoke platform access for Expert "${name}"? They will see the pending verification screen until re-approved.`,
    btnLabel: "Revoke",
    btnColor: "#d97706",
  },
  unlock: {
    title:    "Unlock account",
    body:     (name) => `Clear the hard lock and reset failed-attempt counter for "${name}"?`,
    btnLabel: "Unlock",
    btnColor: "#2563eb",
  },
};

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
  tabBar: { display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--orca-line)" },
  tab: { fontSize: 13, fontWeight: 500, padding: "8px 16px", border: "none", borderBottom: "2px solid transparent", background: "transparent", color: "var(--orca-muted)", cursor: "pointer", borderRadius: "6px 6px 0 0" },
  tabActive: { color: "var(--orca-hi)", borderBottom: "2px solid var(--orca-hi)", background: "rgba(255,179,35,0.06)" },
  filters: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  searchInput: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", width: 220 },
  select: { fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)" },
  tableWrap: { border: "1px solid var(--orca-line)", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "9px 14px", fontSize: 11, fontWeight: 500, color: "var(--orca-muted)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--orca-line)", background: "var(--orca-slate)" },
  td: { padding: "11px 14px", borderBottom: "1px solid var(--orca-line)", verticalAlign: "middle" },
  name: { fontWeight: 500, color: "var(--orca-ink)" },
  email: { fontSize: 12, color: "var(--orca-muted)", fontFamily: "monospace" },
  badge: { fontSize: 11, padding: "2px 8px", borderRadius: 100, fontWeight: 500, whiteSpace: "nowrap" },
  empty: { padding: "2rem", textAlign: "center", color: "var(--orca-muted)" },
  count: { fontSize: 12, color: "var(--orca-muted)", marginTop: 10, textAlign: "right" },
  deletedNote: { fontSize: 11, color: "var(--orca-muted)", fontStyle: "italic", letterSpacing: "0.02em" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  dialog: { background: "var(--orca-slate)", border: "1px solid var(--orca-line)", borderRadius: 14, padding: "28px 32px", maxWidth: 420, width: "90%" },
  dialogTitle: { fontSize: 17, fontWeight: 700, margin: "0 0 10px", color: "var(--orca-ink)" },
  dialogBody: { fontSize: 14, color: "var(--orca-muted)", margin: "0 0 24px", lineHeight: 1.55 },
  dialogBtns: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "transparent", color: "var(--orca-ink)", cursor: "pointer" },
  confirmBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, border: "none", color: "#fff", cursor: "pointer", fontWeight: 600 },
};