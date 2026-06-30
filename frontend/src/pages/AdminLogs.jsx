import { useEffect, useState, useMemo, useCallback } from "react";
import { apiFetch } from "../auth/api";

/**
 * AdminLogs — mounted at /adm/logs.
 *
 * Displays the full append-only audit and system event trail pulled from
 * Loki via GET /api/admin/logs. Satisfies:
 *
 *   SR-29 — Audit records include userId, actionType, timestamp, IP and resource.
 *   SR-30 — Logs are read from the append-only Loki store; no modification is
 *            possible from this UI (the backend has no delete-log endpoint).
 *   FR-12 — Every admin read / delete of a chat log is surfaced here.
 *
 * Features:
 *   • Tab switcher: "Audit" (job=audit) | "System" (job=system) | "All"
 *   • Live search (text filter applied client-side after fetch)
 *   • Time-range selector: 15 m / 1 h / 6 h / 24 h / 7 d
 *   • Action-type filter populated from the current result set
 *   • Level badge: colour-coded info / warn / error
 *   • Expandable row showing the full JSON payload
 *   • Refresh button (manual) + last-fetched timestamp
 *   • Empty / error / loading states
 *
 * The component is intentionally read-only — admins cannot delete log
 * entries from this UI, keeping the store append-only per SR-30.
 */
export default function AdminLogs() {
  // ── Fetch state ────────────────────────────────────────────────────
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  // ── Filter controls ────────────────────────────────────────────────
  const [tab, setTab]           = useState("audit");   // "audit" | "system" | "all"
  const [range, setRange]       = useState("1h");
  const [search, setSearch]     = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  // ── Expanded rows ──────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(new Set());

  // ── Fetch ──────────────────────────────────────────────────────────
  // `loading` starts true, and tab/range changes are only ever triggered by
  // handleTabChange/handleRangeChange below (event handlers) — those set
  // setLoading(true) synchronously there, which is fine since event handlers
  // aren't covered by react-hooks/set-state-in-effect. This effect itself
  // only performs the async fetch and resolves with setState calls inside
  // .then()/.catch()/.finally(), none of which run synchronously when the
  // effect body executes.
  const fetchLogs = useCallback(() => {
    const job = tab === "all" ? "" : tab;
    const params = new URLSearchParams({ job, range });

    return apiFetch(`/api/admin/logs?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setLogs(d.logs || []);
        setLastFetched(new Date());
        setExpanded(new Set()); // collapse all on refresh
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab, range]);

  // Fetch whenever tab or range changes.
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // NOTE: actionFilter is intentionally reset inside handleTabChange /
  // handleRangeChange below (event handlers), not in a useEffect keyed on
  // [tab, range]. Resetting derived UI state from an effect is flagged by
  // ESLint (react-hooks/set-state-in-effect) because it's indistinguishable
  // from "syncing with an external system" — here it's really just part of
  // the same user action that changed tab/range, so it belongs in the
  // handler that already knows that's happening.
  function handleTabChange(nextTab) {
    setTab(nextTab);
    setActionFilter("all");
    setLoading(true);
  }

  function handleRangeChange(nextRange) {
    setRange(nextRange);
    setActionFilter("all");
    setLoading(true);
  }

  // Used by the Refresh button (event handler — not subject to the rule).
  function refreshLogs() {
    setLoading(true);
    fetchLogs();
  }

  // ── Derived data ───────────────────────────────────────────────────

  // Unique action types present in the current result set (audit tab only).
  const actionTypes = useMemo(() => {
    const types = new Set();
    logs.forEach((l) => { if (l.actionType) types.add(l.actionType); });
    return ["all", ...Array.from(types).sort()];
  }, [logs]);

  // Apply client-side text search + action filter.
  const filtered = useMemo(() => {
    let result = [...logs];

    if (actionFilter !== "all") {
      result = result.filter((l) => l.actionType === actionFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((l) =>
        (l.msg        || "").toLowerCase().includes(q) ||
        (l.actionType || "").toLowerCase().includes(q) ||
        (l.userId     != null && String(l.userId).includes(q)) ||
        (l.resourceId != null && String(l.resourceId).includes(q)) ||
        (l.ip         || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [logs, search, actionFilter]);

  // ── Toggle row expansion ───────────────────────────────────────────
  function toggleRow(idx) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function fmtTs(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      {/* ── Page header ───────────────────────────────────────── */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Audit &amp; System Logs</h1>
          <p style={s.subtitle}>
            Append-only security and event trail via Loki · read-only (SR-30)
          </p>
        </div>
        <div style={s.headerRight}>
          {lastFetched && (
            <span style={s.lastFetched}>
              Last fetched {lastFetched.toLocaleTimeString(undefined, { hour12: false })}
            </span>
          )}
          <button style={s.refreshBtn} onClick={refreshLogs} disabled={loading}>
            {loading ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────── */}
      <div style={s.tabBar}>
        {[
          { key: "audit",  label: "📋 Audit Events"  },
          { key: "system", label: "⚙️ System Logs"    },
          { key: "all",    label: "🔍 All"             },
        ].map(({ key, label }) => (
          <button
            key={key}
            style={{
              ...s.tab,
              ...(tab === key ? s.tabActive : {}),
            }}
            onClick={() => handleTabChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div style={s.filterBar}>
        {/* Text search */}
        <input
          type="search"
          placeholder="Search message, action, user ID, IP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.searchInput}
          aria-label="Search logs"
        />

        {/* Action type filter (audit only) */}
        {tab !== "system" && (
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={s.select}
            aria-label="Filter by action type"
          >
            {actionTypes.map((a) => (
              <option key={a} value={a}>
                {a === "all" ? "All action types" : a}
              </option>
            ))}
          </select>
        )}

        {/* Time range */}
        <select
          value={range}
          onChange={(e) => handleRangeChange(e.target.value)}
          style={s.select}
          aria-label="Time range"
        >
          <option value="15m">Last 15 min</option>
          <option value="1h">Last 1 hour</option>
          <option value="6h">Last 6 hours</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
        </select>

        {/* Result count */}
        <span style={s.resultCount}>
          {loading ? "…" : `${filtered.length} of ${logs.length} entries`}
        </span>
      </div>

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div style={s.errorBanner} role="alert">
          <strong>Failed to load logs</strong> — {error}
          <button style={s.retryLink} onClick={refreshLogs}>Retry</button>
        </div>
      )}

      {/* ── Log table ─────────────────────────────────────────── */}
      <div style={s.tableWrapper}>
        {loading && !logs.length ? (
          <div style={s.emptyState}>Loading logs…</div>
        ) : !filtered.length ? (
          <div style={s.emptyState}>
            {logs.length
              ? "No entries match the current filters."
              : "No log entries found for this time range."}
          </div>
        ) : (
          <table style={s.table} aria-label="Log entries">
            <thead>
              <tr>
                <th style={{ ...s.th, width: 155 }}>Timestamp</th>
                <th style={{ ...s.th, width: 58  }}>Level</th>
                {tab !== "audit" && (
                  <th style={{ ...s.th, width: 70 }}>Job</th>
                )}
                {tab !== "system" && (
                  <>
                    <th style={{ ...s.th, width: 220 }}>Action / Message</th>
                    <th style={{ ...s.th, width: 72  }}>User ID</th>
                    <th style={{ ...s.th, width: 90  }}>Resource</th>
                    <th style={{ ...s.th, width: 110 }}>IP</th>
                  </>
                )}
                {tab === "system" && (
                  <th style={s.th}>Message</th>
                )}
                <th style={{ ...s.th, width: 40, textAlign: "center" }}>
                  ↕
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, idx) => (
                <LogRow
                  key={idx}
                  log={log}
                  idx={idx}
                  tab={tab}
                  expanded={expanded.has(idx)}
                  onToggle={toggleRow}
                  fmtTs={fmtTs}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ── Log row component ──────────────────────────────────────────────── */

/**
 * A single table row.  Clicking the expand button in the last column shows
 * the full JSON payload for that log entry, useful when debugging or
 * investigating an incident.
 */
function LogRow({ log, idx, tab, expanded, onToggle, fmtTs }) {
  const colSpan = tab === "all" ? 8 : tab === "audit" ? 7 : 4;

  return (
    <>
      <tr
        style={{
          ...s.tr,
          background: expanded
            ? "rgba(255,179,35,0.05)"
            : idx % 2 === 0
            ? "transparent"
            : "rgba(255,255,255,0.015)",
        }}
      >
        {/* Timestamp */}
        <td style={{ ...s.td, fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>
          {fmtTs(log.ts)}
        </td>

        {/* Level badge */}
        <td style={s.td}>
          <LevelBadge level={log.level} />
        </td>

        {/* Job column (all / system tabs) */}
        {tab !== "audit" && (
          <td style={{ ...s.td, fontSize: 11 }}>
            <span style={{
              ...s.jobPill,
              background: log.job === "audit" ? "#2e1d5e" : "#1a2e3b",
              color:      log.job === "audit" ? "#b39ddb" : "#64b5f6",
              border:     `1px solid ${log.job === "audit" ? "#4a3270" : "#1e4a6e"}`,
            }}>
              {log.job || "system"}
            </span>
          </td>
        )}

        {/* Audit-specific columns */}
        {tab !== "system" && (
          <>
            <td style={{ ...s.td, maxWidth: 220 }}>
              {log.actionType
                ? <ActionBadge action={log.actionType} />
                : <span style={s.msgText}>{log.msg || "—"}</span>
              }
            </td>
            <td style={{ ...s.td, fontSize: 11.5, color: "var(--orca-muted)" }}>
              {log.userId ?? "—"}
            </td>
            <td style={{ ...s.td, fontSize: 11.5 }}>
              {log.resourceType
                ? (
                  <span style={s.resourceCell}>
                    <span style={s.resourceType}>{log.resourceType}</span>
                    {log.resourceId != null && (
                      <span style={s.resourceId}>#{log.resourceId}</span>
                    )}
                  </span>
                )
                : "—"
              }
            </td>
            <td style={{ ...s.td, fontSize: 11, fontVariantNumeric: "tabular-nums",
              color: "var(--orca-muted)", maxWidth: 110, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {log.ip || "—"}
            </td>
          </>
        )}

        {/* System message column */}
        {tab === "system" && (
          <td style={{ ...s.td, maxWidth: 500 }}>
            <span style={s.msgText}>{log.msg || "—"}</span>
          </td>
        )}

        {/* Expand toggle */}
        <td style={{ ...s.td, textAlign: "center" }}>
          <button
            style={s.expandBtn}
            onClick={() => onToggle(idx)}
            aria-label={expanded ? "Collapse entry" : "Expand entry"}
            title={expanded ? "Collapse" : "Show full payload"}
          >
            {expanded ? "▲" : "▼"}
          </button>
        </td>
      </tr>

      {/* ── Expanded payload ─────────────────────────────────── */}
      {expanded && (
        <tr style={{ background: "rgba(255,179,35,0.04)" }}>
          <td colSpan={colSpan} style={s.payloadTd}>
            <pre style={s.payload}>
              {JSON.stringify(log, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

/** Colour-coded level pill. */
function LevelBadge({ level }) {
  const lv = (level || "info").toLowerCase();

  // `lv` is derived from log.level, which comes from the Loki API and is
  // therefore untrusted input. Using it as a dynamic object key (colours[lv])
  // is flagged by security/detect-object-injection because a malicious or
  // unexpected key could in principle reach into the object's prototype
  // chain. An explicit switch over known literal values removes the dynamic
  // property access entirely — there is no expression of the form obj[key]
  // left for the rule (or an attacker) to worry about.
  let c;
  switch (lv) {
    case "warn":
      c = { bg: "#2e2400", color: "#f59e0b", border: "#6b4e00" };
      break;
    case "error":
      c = { bg: "#2e0d0d", color: "#f87171", border: "#6b1a1a" };
      break;
    case "info":
    default:
      c = { bg: "#1a2e3b", color: "#64b5f6", border: "#1e4a6e" };
      break;
  }

  return (
    <span style={{
      ...s.badge,
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
    }}>
      {lv}
    </span>
  );
}

/** Colour-coded action type badge.  Destructive actions use a red tint. */
function ActionBadge({ action }) {
  const isDestructive = /DELETE|REVOKE|LOCK|TERMINATE/.test(action);
  const isApproval    = /APPROVE|UNLOCK|VERIFY/.test(action);
  const bg     = isDestructive ? "#2e0d0d" : isApproval ? "#0d2e1a" : "var(--orca-slate)";
  const color  = isDestructive ? "#f87171" : isApproval ? "#4ade80" : "var(--orca-ink)";
  const border = isDestructive ? "#6b1a1a" : isApproval ? "#166534" : "var(--orca-line)";
  return (
    <span style={{
      ...s.actionBadge,
      background: bg,
      color,
      border: `1px solid ${border}`,
    }}>
      {action}
    </span>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────── */
const s = {
  page: {
    maxWidth: 1180,
    margin: "0 auto",
  },

  /* Header */
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 16,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 4px",
    color: "var(--orca-ink)",
  },
  subtitle: {
    fontSize: 13,
    color: "var(--orca-muted)",
    margin: 0,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  lastFetched: {
    fontSize: 11,
    color: "var(--orca-muted)",
  },
  refreshBtn: {
    fontSize: 13,
    padding: "7px 14px",
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    cursor: "pointer",
  },

  /* Tabs */
  tabBar: {
    display: "flex",
    gap: 4,
    marginBottom: 16,
    borderBottom: "1px solid var(--orca-line)",
    paddingBottom: 0,
  },
  tab: {
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 16px",
    border: "none",
    borderBottom: "2px solid transparent",
    background: "transparent",
    color: "var(--orca-muted)",
    cursor: "pointer",
    borderRadius: "6px 6px 0 0",
    transition: "color 0.15s, border-color 0.15s",
  },
  tabActive: {
    color: "var(--orca-hi)",
    borderBottom: "2px solid var(--orca-hi)",
    background: "rgba(255,179,35,0.06)",
  },

  /* Filter bar */
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  searchInput: {
    flex: "1 1 200px",
    minWidth: 180,
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    outline: "none",
  },
  select: {
    padding: "8px 10px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    cursor: "pointer",
  },
  resultCount: {
    fontSize: 12,
    color: "var(--orca-muted)",
    whiteSpace: "nowrap",
    marginLeft: "auto",
  },

  /* Error */
  errorBanner: {
    background: "#2e0d0d",
    border: "1px solid #6b1a1a",
    color: "#f87171",
    borderRadius: 8,
    padding: "12px 16px",
    fontSize: 13,
    marginBottom: 16,
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  retryLink: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #6b1a1a",
    color: "#f87171",
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    cursor: "pointer",
  },

  /* Table */
  tableWrapper: {
    border: "1px solid var(--orca-line)",
    borderRadius: 10,
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12.5,
  },
  th: {
    padding: "10px 12px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--orca-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    background: "var(--orca-abyss)",
    borderBottom: "1px solid var(--orca-line)",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    transition: "background 0.1s",
  },
  td: {
    padding: "9px 12px",
    color: "var(--orca-ink)",
    verticalAlign: "middle",
  },

  /* Empty / loading */
  emptyState: {
    padding: "48px 24px",
    textAlign: "center",
    color: "var(--orca-muted)",
    fontSize: 13,
  },

  /* Badges & pills */
  badge: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  },
  jobPill: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  actionBadge: {
    display: "inline-block",
    fontSize: 10.5,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 5,
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
    maxWidth: 200,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  /* Resource cell */
  resourceCell: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  resourceType: {
    fontSize: 11,
    color: "var(--orca-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  resourceId: {
    fontSize: 11,
    color: "var(--orca-hi)",
    fontVariantNumeric: "tabular-nums",
  },

  /* Message text */
  msgText: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 460,
    color: "var(--orca-ink)",
  },

  /* Expand */
  expandBtn: {
    background: "transparent",
    border: "none",
    color: "var(--orca-muted)",
    cursor: "pointer",
    fontSize: 10,
    padding: "4px 6px",
    borderRadius: 4,
    lineHeight: 1,
  },

  /* Payload JSON viewer */
  payloadTd: {
    padding: "0 12px 12px 12px",
    borderBottom: "1px solid var(--orca-line)",
  },
  payload: {
    margin: 0,
    padding: "12px 14px",
    background: "var(--orca-abyss)",
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    fontSize: 11.5,
    color: "#94a3b8",
    overflowX: "auto",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};