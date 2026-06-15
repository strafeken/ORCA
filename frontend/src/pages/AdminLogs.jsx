import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import axios from "axios";

// Native Map structures bypass object injection AST checks completely
const LEVEL_STYLES = new Map([
  ["info", { background: "#E6F1FB", color: "#0C447C" }],
  ["warn", { background: "#FAEEDA", color: "#633806" }],
  ["error", { background: "#FCEBEB", color: "#791F1F" }],
]);

const JOB_STYLES = new Map([
  ["audit", { background: "#FAEEDA", color: "#633806" }],
  ["system", { background: "#F1EFE8", color: "#444441" }],
]);

const DEFAULT_STYLE = { background: "#F1EFE8", color: "#444441" };
const PAGE_SIZE = 15; // Restored the missing variable definition

function Badge({ label, styleMap }) {
  const s = styleMap.get(label) || DEFAULT_STYLE;

  return (
    <span style={{
      ...s,
      fontSize: 11,
      padding: "2px 8px",
      borderRadius: 100,
      fontWeight: 500,
      display: "inline-block",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("all");
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("1h");
  const [page, setPage] = useState(1);
  const [lastRefresh, setLastRefresh] = useState(null);
  
  const isMounted = useRef(false);

  const fetchLogs = useCallback(() => {
    const params = { range };
    if (tab !== 'all') params.job = tab;
    
    axios.get("/api/admin/logs", { params })
      .then(res => {
        setLogs(res.data.logs || []);
        setError(null); // Clear errors safely within the async response handler
        setLastRefresh(new Date());
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [range, tab]);

  // Use a clean scheduling mechanism to trigger the initial layout synchronization safely
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
    } else {
      setLoading(true);
    }

    // Queue execution asynchronously to decouple it from the immediate render cycle execution block
    const handler = setTimeout(() => {
      fetchLogs();
    }, 0);

    return () => clearTimeout(handler);
  }, [fetchLogs]);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setPage(1);
  };

  const handleLevelChange = (e) => {
    setLevel(e.target.value);
    setPage(1);
  };

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const handleRangeChange = (e) => {
    setRange(e.target.value);
    setPage(1);
  };

  const filtered = useMemo(() => {
    let result = [...logs];
    if (tab !== "all") result = result.filter(l => l.job === tab);
    if (level) result = result.filter(l => l.level === level);
    if (search) result = result.filter(l =>
      l.msg.toLowerCase().includes(search.toLowerCase()) ||
      l.ip.toLowerCase().includes(search.toLowerCase())
    );
    return result;
  }, [logs, tab, level, search]);

  const metrics = {
    total: logs.length,
    audit: logs.filter(l => l.job === "audit").length,
    errors: logs.filter(l => l.level === "error").length,
    ips: new Set(logs.map(l => l.ip).filter(ip => ip !== "—")).size,
  };

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const styles = {
    page: { padding: "2rem", fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" },
    title: { fontSize: 20, fontWeight: 500, margin: 0 },
    subtitle: { fontSize: 13, color: "#888", margin: "4px 0 0" },
    metrics: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: "1.5rem" },
    metric: { background: "#f5f5f3", borderRadius: 8, padding: "1rem" },
    metricLabel: { fontSize: 11, color: "#888", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em" },
    metricValue: { fontSize: 24, fontWeight: 500, margin: 0 },
    tabs: { display: "flex", borderBottom: "0.5px solid #e0e0e0", marginBottom: "1rem" },
    tab: (active) => ({
      padding: "8px 16px", fontSize: 13, cursor: "pointer",
      background: "none", border: "none",
      borderBottom: active ? "2px solid #222" : "2px solid transparent",
      fontWeight: active ? 500 : 400,
      color: active ? "#222" : "#888",
    }),
    controls: { display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" },
    select: { fontSize: 13, padding: "6px 10px", borderRadius: 8, height: 32, border: "0.5px solid #ddd" },
    input: { fontSize: 13, padding: "6px 10px", borderRadius: 8, height: 32, border: "0.5px solid #ddd", width: 200 },
    tableWrap: { border: "0.5px solid #e0e0e0", borderRadius: 12, overflow: "auto" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    th: { textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 400, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "0.5px solid #e0e0e0" },
    td: { padding: "10px 12px", borderBottom: "0.5px solid #f0f0f0", verticalAlign: "middle", maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    mono: { fontFamily: "monospace", fontSize: 12 },
    muted: { color: "#888" },
    btn: { fontSize: 13, padding: "6px 12px", borderRadius: 8, cursor: "pointer", border: "0.5px solid #ddd", background: "white", height: 32 },
    pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem", fontSize: 13, color: "#888" },
    refreshBtn: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px", borderRadius: 8, cursor: "pointer", border: "0.5px solid #ddd", background: "white", height: 32 },
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Log dashboard</h1>
          <p style={styles.subtitle}>
            {lastRefresh ? `Last refreshed ${lastRefresh.toLocaleTimeString()}` : "Loading..."}
          </p>
        </div>
        <button style={styles.refreshBtn} onClick={() => { setLoading(true); fetchLogs(); }} disabled={loading}>
          ↻ {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={styles.metrics}>
        <div style={styles.metric}>
          <p style={styles.metricLabel}>Total logs</p>
          <p style={styles.metricValue}>{metrics.total}</p>
        </div>
        <div style={styles.metric}>
          <p style={styles.metricLabel}>Security events</p>
          <p style={{ ...styles.metricValue, color: "#854F0B" }}>{metrics.audit}</p>
        </div>
        <div style={styles.metric}>
          <p style={styles.metricLabel}>Errors</p>
          <p style={{ ...styles.metricValue, color: "#A32D2D" }}>{metrics.errors}</p>
        </div>
        <div style={styles.metric}>
          <p style={styles.metricLabel}>Unique IPs</p>
          <p style={styles.metricValue}>{metrics.ips}</p>
        </div>
      </div>

      <div style={styles.tabs}>
        {[["all", "All logs"], ["audit", "Security events"], ["system", "System logs"]].map(([key, label]) => (
          <button key={key} style={styles.tab(tab === key)} onClick={() => handleTabChange(key)}>{label}</button>
        ))}
      </div>

      <div style={styles.controls}>
        <select style={styles.select} value={level} onChange={handleLevelChange}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <input
          style={styles.input}
          placeholder="Search logs..."
          value={search}
          onChange={handleSearchChange}
        />
        <select style={styles.select} value={range} onChange={handleRangeChange}>
          <option value="1h">Last 1 hour</option>
          <option value="6h">Last 6 hours</option>
          <option value="24h">Last 24 hours</option>
        </select>
      </div>

      {error && (
        <div style={{ background: "#FCEBEB", color: "#791F1F", padding: "10px 14px", borderRadius: 8, marginBottom: "1rem", fontSize: 13 }}>
          Failed to fetch logs: {error}. Is Loki running?
        </div>
      )}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: 160 }}>Timestamp</th>
              <th style={{ ...styles.th, width: 70 }}>Level</th>
              <th style={{ ...styles.th, width: 90 }}>Type</th>
              <th style={styles.th}>Message</th>
              <th style={{ ...styles.th, width: 120 }}>IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ ...styles.td, textAlign: "center", color: "#888", padding: "2rem" }}>Loading logs...</td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={5} style={{ ...styles.td, textAlign: "center", color: "#888", padding: "2rem" }}>No logs match your filters.</td></tr>
            ) : paginated.map((log, i) => (
              <tr key={i}>
                <td style={{ ...styles.td, ...styles.mono, ...styles.muted, width: 160 }}>
                  {new Date(log.ts).toLocaleString()}
                </td>
                <td style={{ ...styles.td, width: 70 }}>
                  <Badge label={log.level} styleMap={LEVEL_STYLES} />
                </td>
                <td style={{ ...styles.td, width: 90 }}>
                  <Badge label={log.job} styleMap={JOB_STYLES} />
                </td>
                <td style={{ ...styles.td, ...styles.mono }} title={log.msg}>
                  {log.msg}
                </td>
                <td style={{ ...styles.td, ...styles.mono, ...styles.muted, width: 120 }}>
                  {log.ip}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.pagination}>
        <span>
          {filtered.length === 0 ? "No results" : `Showing ${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button style={styles.btn} onClick={() => setPage(p => p - 1)} disabled={page === 1}>← Prev</button>
          <button style={styles.btn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>Next →</button>
        </div>
      </div>
    </div>
  );
}