import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../auth/api";

/**
 * AdminDashboard — mounted at /adm/managementDashboard.
 *
 * Shows at-a-glance platform stats (pulled live from the admin API) and
 * links to the four management sub-pages. Stats are fetched in parallel
 * and degrade gracefully if either request fails.
 */
export default function AdminDashboard() {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/admin/users").then((r) => r.json()).catch(() => ({ users: [] })),
      apiFetch("/api/admin/sessions").then((r) => r.json()).catch(() => ({ sessions: [] })),
    ]).then(([usersData, sessData]) => {
      const users    = usersData.users    || [];
      const sessions = sessData.sessions  || [];

      // is_deleted is a computed boolean the backend returns based on the
      // @orca-deleted email tombstone stamped during soft-deletion. Deleted
      // rows stay in the DB to preserve FK references from messages and
      // conversations, but they are not real accounts so they must be
      // excluded from every stat to avoid misleading the admin.
      const active = users.filter((u) => !u.is_deleted);

      setStats({
        totalUsers:     active.length,
        hardLocked:     active.filter((u) => u.is_hard_locked).length,
        pendingExperts: active.filter((u) => u.role === "expert" && !u.is_approved).length,
        activeSessions: sessions.length,
      });
    }).finally(() => setLoading(false));
  }, []);

  const navCards = [
    {
      to:    "/adm/users",
      icon:  "🫆",
      label: "User Management",
      desc:  "View, delete accounts, approve experts and manage lockouts",
    },
    {
      to:    "/adm/sessions",
      icon:  "🔑",
      label: "Active Sessions",
      desc:  "View all live sessions and terminate any suspicious one",
    },
    {
      to:    "/adm/chatlogs",
      icon:  "💬",
      label: "Chat Logs",
      desc:  "Read and permanently delete conversation logs for moderation",
    },
    {
      to:    "/adm/logs",
      icon:  "📋",
      label: "Audit & System Logs",
      desc:  "Full append-only security and system event trail via Loki",
    },
  ];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Admin Dashboard</h1>
        <p style={s.subtitle}>Platform overview · Management tools · Audit trail</p>
      </div>

      {/* ── Stats row ─────────────────────────────────── */}
      <div style={s.statsRow}>
        <StatCard label="Total Users"          value={loading ? null : stats?.totalUsers}    />
        <StatCard label="Active Sessions"      value={loading ? null : stats?.activeSessions} />
        <StatCard label="Pending Expert Approvals" value={loading ? null : stats?.pendingExperts} warn />
        <StatCard label="Hard-Locked Accounts"value={loading ? null : stats?.hardLocked}   warn />
      </div>

      {/* ── Navigation grid ───────────────────────────── */}
      <h2 style={s.sectionTitle}>Management</h2>
      <div style={s.grid}>
        {navCards.map((c) => (
          <Link key={c.to} to={c.to} style={s.card}>
            <span style={s.icon}>{c.icon}</span>
            <strong style={s.cardTitle}>{c.label}</strong>
            <p style={s.cardDesc}>{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, warn }) {
  const isAlert = warn && typeof value === "number" && value > 0;
  return (
    <div style={s.stat}>
      <p style={s.statLabel}>{label}</p>
      <p style={{ ...s.statValue, color: isAlert ? "#b45309" : "var(--orca-ink)" }}>
        {value === null ? "…" : value}
      </p>
    </div>
  );
}

const s = {
  page: { maxWidth: 880, margin: "0 auto" },
  header: { marginBottom: 28 },
  title: { fontSize: 22, fontWeight: 700, margin: "0 0 4px", color: "var(--orca-ink)" },
  subtitle: { fontSize: 13, color: "var(--orca-muted)", margin: 0 },

  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    marginBottom: 32,
  },
  stat: {
    background: "var(--orca-slate)",
    border: "1px solid var(--orca-line)",
    borderRadius: 10,
    padding: "16px 20px",
  },
  statLabel: {
    fontSize: 11,
    color: "var(--orca-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: "0 0 8px",
  },
  statValue: { fontSize: 28, fontWeight: 700, margin: 0 },

  sectionTitle: { fontSize: 14, fontWeight: 600, color: "var(--orca-muted)", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 14,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--orca-slate)",
    border: "1px solid var(--orca-line)",
    borderRadius: 12,
    padding: "22px 24px",
    textDecoration: "none",
    color: "var(--orca-ink)",
    transition: "border-color 0.15s",
  },
  icon:     { fontSize: 26 },
  cardTitle: { fontSize: 15, fontWeight: 600, color: "var(--orca-ink)", margin: 0 },
  cardDesc:  { fontSize: 13, color: "var(--orca-muted)", margin: 0, lineHeight: 1.5 },
};