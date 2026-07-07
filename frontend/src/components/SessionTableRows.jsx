import {
  formatAgent,
  idleWarnColor,
  SESSION_ROLE_COLORS,
  timeIdle,
  timeUntil,
} from "../utils/sessionDisplay";

/** Always returns an array of table rows for consistent render typing. */
export default function SessionTableRows({ loading, filtered, now, onTerminate, styles }) {
  if (loading) {
    return [
      <tr key="loading">
        <td colSpan={8} style={styles.empty}>Loading sessions…</td>
      </tr>,
    ];
  }
  if (filtered.length === 0) {
    return [
      <tr key="empty">
        <td colSpan={8} style={styles.empty}>No active sessions.</td>
      </tr>,
    ];
  }
  return filtered.map((sess) => (
    <tr key={sess.id}>
      <td style={styles.td}>
        <span style={styles.name}>{sess.name}</span>
        <br />
        <span style={styles.email}>{sess.email}</span>
      </td>
      <td style={styles.td}>
        <span style={{ ...styles.badge, color: SESSION_ROLE_COLORS[sess.role] || "#94a3b8" }}>
          {sess.role}
        </span>
      </td>
      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 12 }}>
        {sess.source_ip || "—"}
      </td>
      <td
        style={{
          ...styles.td,
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "monospace",
          fontSize: 11,
          color: "var(--orca-muted)",
        }}
        title={sess.user_agent}
      >
        {formatAgent(sess.user_agent)}
      </td>
      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 12, color: "var(--orca-muted)" }}>
        {new Date(sess.created_at).toLocaleString()}
      </td>
      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 12, color: idleWarnColor(sess.last_activity, now) }}>
        {timeIdle(sess.last_activity, now)}
      </td>
      <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 12 }}>
        {timeUntil(sess.expires_at, now)}
      </td>
      <td style={{ ...styles.td, textAlign: "right" }}>
        <button style={styles.terminateBtn} onClick={() => onTerminate(sess)}>
          Terminate
        </button>
      </td>
    </tr>
  ));
}
