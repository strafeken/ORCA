export function formatAgent(ua) {
  if (!ua) return "—";
  return ua.length > 60 ? ua.slice(0, 60) + "…" : ua;
}

export function timeUntil(expires, now) {
  const diff = new Date(expires) - now;
  if (diff <= 0) return "expired";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function timeIdle(lastActivity, now) {
  if (!lastActivity) return "—";
  const diff = now - new Date(lastActivity);
  if (diff < 30_000) return "just now";
  const m = Math.floor(diff / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s ago` : `${s}s ago`;
}

export function idleWarnColor(lastActivity, now) {
  if (!lastActivity) return "var(--orca-muted)";
  const idleMs = now - new Date(lastActivity);
  return idleMs > 10 * 60 * 1000 ? "#d97706" : "var(--orca-muted)";
}

export const SESSION_ROLE_COLORS = { worker: "#60a5fa", expert: "#a78bfa", admin: "#f472b6" };
