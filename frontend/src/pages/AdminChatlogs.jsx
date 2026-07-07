import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../auth/api";
import { useAuthedBlobUrl } from "../hooks/useAuthedBlobURL";

/**
 * AdminChatLogs — mounted at /admin/chatlogs.
 *
 * Two-panel layout:
 *   Left  — searchable list of all conversations with participant names
 *           and message counts.
 *   Right — full message thread for the selected conversation, with a
 *           "Delete chat log" button (requires confirmation).
 *
 * Every admin view of a log is written to the audit trail server-side.
 * Every deletion is also audited and the audit entry is written BEFORE
 * the SQL DELETE so it can never be lost. (FR-12, SR-11, SR-27, SR-29)
 */
export default function AdminChatLogs() {
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs]   = useState(true);
  const [convError, setConvError]         = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [search, setSearch]               = useState("");

  const [selected, setSelected]           = useState(null); // conversation object
  const [messages, setMessages]           = useState([]);
  const [loadingMsgs, setLoadingMsgs]     = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [feedback, setFeedback]           = useState(null);

  // ── Load conversation list ───────────────────────────────────────────
  // See AdminUserManagement.jsx for the rationale: `loadingConvs` starts
  // true so the mount effect never needs a synchronous setLoadingConvs(true)
  // call, only the async setLoadingConvs(false) in .finally().
  const fetchConversations = useCallback(() => {
    return apiFetch("/api/admin/conversations")
      .then((r) => r.json())
      .then((d) => { setConversations(d.conversations || []); setConvError(null); setLastFetched(new Date()); })
      .catch((e) => setConvError(e.message))
      .finally(() => setLoadingConvs(false));
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Used by the Refresh button (event handler — not subject to the rule).
  function loadConversations() {
    setLoadingConvs(true);
    fetchConversations();
  }

  // ── Load messages when a conversation is selected ───────────────────
  function selectConversation(conv) {
    setSelected(conv);
    setMessages([]);
    setDeleteConfirm(false);
    setFeedback(null);
    setLoadingMsgs(true);
    apiFetch(`/api/admin/conversations/${conv.id}/messages`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }

  // ── Delete chat log ──────────────────────────────────────────────────
  async function deleteLog() {
    if (!selected) return;
    setDeleting(true);
    try {
      const res  = await apiFetch(`/api/admin/conversations/${selected.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Deletion failed.");

      setFeedback({ ok: true, text: `Chat log #${selected.id} permanently deleted and audit entry recorded.` });
      setSelected(null);
      setMessages([]);
      loadConversations();
    } catch (e) {
      setFeedback({ ok: false, text: e.message });
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  // ── Filtered conversation list ───────────────────────────────────────
  const filtered = search
    ? conversations.filter((c) => {
        const q = search.toLowerCase();
        return (
          c.worker_name.toLowerCase().includes(q) ||
          c.expert_name.toLowerCase().includes(q)
        );
      })
    : conversations;

  const ROLE_COLORS = { worker: "#60a5fa", expert: "#a78bfa", admin: "#f472b6" };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Chat Logs</h1>
          <p style={s.subtitle}>
            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={s.headerRight}>
          {lastFetched && (
            <span style={s.lastFetched}>
              Last fetched {lastFetched.toLocaleTimeString(undefined, { hour12: false })}
            </span>
          )}
          <button style={s.refreshBtn} onClick={loadConversations} disabled={loadingConvs}>
            {loadingConvs ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {feedback && (
        <div style={{ ...s.banner, background: feedback.ok ? "#052e16" : "#450a0a", color: feedback.ok ? "#86efac" : "#fca5a5", border: `1px solid ${feedback.ok ? "#166534" : "#991b1b"}` }}>
          {feedback.text}
          <button style={s.bannerClose} onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      <div className={`orca-chatlog-panels${selected ? " has-selection" : ""}`} style={s.panels}>
        {/* ── LEFT: conversation list ── */}
        <div className="orca-chatlog-list" style={s.leftPanel}>
          <input
            style={s.searchInput}
            placeholder="Search participants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {convError && (
            <p style={{ color: "#f87171", fontSize: 13, padding: "8px 0" }}>{convError}</p>
          )}

          {loadingConvs ? (
            <p style={s.emptyMsg}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={s.emptyMsg}>No conversations found.</p>
          ) : (
            <div style={s.convList}>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  style={{
                    ...s.convItem,
                    background: selected?.id === c.id ? "var(--orca-line)" : "transparent",
                    borderLeft: selected?.id === c.id ? "3px solid var(--orca-hi)" : "3px solid transparent",
                  }}
                  onClick={() => selectConversation(c)}
                >
                  <div style={s.convNames}>
                    <span style={s.convName}>{c.worker_name}</span>
                    <span style={s.convSep}>↔</span>
                    <span style={s.convName}>{c.expert_name}</span>
                  </div>
                  <div style={s.convMeta}>
                    <span style={s.convMsgCount}>
                      {c.message_count} msg{c.message_count !== 1 ? "s" : ""}
                    </span>
                    <span style={s.convDate}>
                      {new Date(c.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT: message viewer ── */}
        <div className="orca-chatlog-detail" style={s.rightPanel}>
          {!selected ? (
            <div style={s.noSelection}>
              <span style={{ fontSize: 36 }}>💬</span>
              <p>Select a conversation to view its log.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={s.convHeader}>
                {/* Back to list — mobile only (master-detail). */}
                <button
                  className="orca-chatlog-back"
                  style={s.backBtn}
                  onClick={() => setSelected(null)}
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <div>
                  <span style={s.convTitle}>
                    Conversation #{selected.id}
                  </span>
                  <br />
                  <span style={s.convSubtitle}>
                    {selected.worker_name} (worker) ↔ {selected.expert_name} (expert)
                  </span>
                </div>
                <button
                  style={s.deleteBtn}
                  onClick={() => setDeleteConfirm(true)}
                  disabled={deleting}
                >
                  🗑 Delete log
                </button>
              </div>

              {/* Message thread */}
              <div style={s.messageList}>
                {loadingMsgs ? (
                  <p style={s.emptyMsg}>Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p style={s.emptyMsg}>No messages in this conversation.</p>
                ) : messages.map((m) => (
                  <div key={`${m.type}-${m.id}`} style={s.message}>
                    <div style={s.msgHeader}>
                      <span style={{ ...s.msgSender, color: ROLE_COLORS[m.sender_role] || "#94a3b8" }}>
                        {m.sender_name}
                      </span>
                      <span style={s.msgRole}>{m.sender_role}</span>
                      <span style={s.msgTime}>
                        {new Date(m.sent_at).toLocaleString()}
                      </span>
                    </div>
                    {m.type === "file" ? (
                      <AdminFileItem convId={selected.id} item={m} />
                    ) : m.type === "voice" ? (
                      <AdminVoiceItem convId={selected.id} item={m} />
                    ) : (
                      <p style={s.msgContent}>{m.content}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Confirm delete dialog ── */}
      {deleteConfirm && selected && (
        <div style={s.overlay}>
          <div style={s.dialog}>
            <h2 style={s.dialogTitle}>Permanently delete chat log?</h2>
            <p style={s.dialogBody}>
              This will permanently delete all {selected.message_count} text message
              {selected.message_count !== 1 ? "s" : ""} in conversation #{selected.id}
              between <strong>{selected.worker_name}</strong> and{" "}
              <strong>{selected.expert_name}</strong>, along with every uploaded
              file, image and voice message — removed from both the database and
              disk storage.
              <br /><br />
              An audit entry will be written to the log trail before deletion.
              This action <strong>cannot be undone</strong>.
            </p>
            <div style={s.dialogBtns}>
              <button
                style={s.cancelBtn}
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button style={s.confirmDeleteBtn} onClick={deleteLog} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AdminFileItem — renders an uploaded file in the admin log. Images show an
 * inline thumbnail (click to download the original); other files show a
 * download button. Media is fetched through the authenticated admin endpoint
 * via useAuthedBlobUrl, since these are participant/RBAC-gated API routes, not
 * static assets.
 */
function AdminFileItem({ convId, item }) {
  const downloadUrl = `/api/admin/conversations/${convId}/files/${item.id}`;
  const isImage = (item.mime_type || "").startsWith("image/");
  const { objectUrl, error } = useAuthedBlobUrl(isImage ? downloadUrl : null);

  async function download() {
    const res = await apiFetch(downloadUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.original_filename || "file";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isImage) {
    return (
      <div>
        {error ? (
          <div style={s.mediaError}>Could not load image.</div>
        ) : objectUrl ? (
          <button
            type="button"
            style={s.mediaThumbBtn}
            onClick={download}
            title="Click to download original"
            aria-label={`Download ${item.original_filename}`}
          >
            <img
              src={objectUrl}
              alt={item.original_filename}
              style={s.mediaThumb}
            />
          </button>
        ) : (
          <div style={s.mediaLoading}>Loading image…</div>
        )}
        <div style={s.mediaCaption}>🖼 {item.original_filename}</div>
      </div>
    );
  }

  return (
    <button style={s.fileDownloadBtn} onClick={download}>
      📄 {item.original_filename || "Download file"}
    </button>
  );
}

/** AdminVoiceItem — authenticated audio playback of a voice message. */
function AdminVoiceItem({ convId, item }) {
  const downloadUrl = `/api/admin/conversations/${convId}/voice/${item.id}`;
  const { objectUrl, error } = useAuthedBlobUrl(downloadUrl);

  if (error) return <div style={s.mediaError}>Could not load voice message.</div>;
  if (!objectUrl) return <div style={s.mediaLoading}>Loading voice message…</div>;

  return (
    <div style={s.voiceRow}>
      <audio controls src={objectUrl} style={{ width: 260 }}>
        <track kind="captions" label="Captions unavailable" />
      </audio>
      {item.duration_seconds ? <span style={s.voiceDur}>{item.duration_seconds}s</span> : null}
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
  panels: { display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, minHeight: 600 },

  // Left
  leftPanel: { display: "flex", flexDirection: "column", gap: 10 },
  searchInput: { fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", width: "100%", boxSizing: "border-box" },
  convList: { display: "flex", flexDirection: "column", gap: 2, overflow: "auto", maxHeight: 600 },
  convItem: { textAlign: "left", padding: "10px 12px", border: "none", borderRadius: 8, cursor: "pointer", width: "100%" },
  convNames: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  convName: { fontSize: 13, fontWeight: 500, color: "var(--orca-ink)" },
  convSep: { fontSize: 11, color: "var(--orca-muted)" },
  convMeta: { display: "flex", justifyContent: "space-between", marginTop: 4 },
  convMsgCount: { fontSize: 11, color: "var(--orca-muted)" },
  convDate: { fontSize: 11, color: "var(--orca-muted)", fontFamily: "monospace" },
  emptyMsg: { color: "var(--orca-muted)", fontSize: 13, textAlign: "center", padding: "2rem 0" },

  // Right
  rightPanel: { border: "1px solid var(--orca-line)", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden" },
  noSelection: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--orca-muted)", fontSize: 14, gap: 10 },
  convHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--orca-line)", background: "var(--orca-slate)" },
  // display is controlled by CSS (.orca-chatlog-back) — hidden on desktop,
  // shown on mobile — so it isn't set here.
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-abyss)", color: "var(--orca-ink)", fontSize: 16, cursor: "pointer", flexShrink: 0 },
  convTitle: { fontSize: 14, fontWeight: 700, color: "var(--orca-ink)" },
  convSubtitle: { fontSize: 12, color: "var(--orca-muted)", marginTop: 2 },
  deleteBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #dc2626", background: "transparent", color: "#f87171", cursor: "pointer", fontWeight: 500 },
  messageList: { overflowY: "auto", maxHeight: 560, padding: "12px 0" },
  message: { padding: "10px 18px", borderBottom: "0.5px solid var(--orca-line)" },
  msgHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  msgSender: { fontWeight: 600, fontSize: 13 },
  msgRole: { fontSize: 10, color: "var(--orca-muted)", background: "var(--orca-line)", padding: "1px 6px", borderRadius: 4 },
  msgTime: { fontSize: 11, color: "var(--orca-muted)", fontFamily: "monospace", marginLeft: "auto" },
  msgContent: { fontSize: 13, color: "var(--orca-ink)", margin: 0, lineHeight: 1.55, wordBreak: "break-word" },
  mediaThumbBtn: { padding: 0, border: "none", background: "none", cursor: "pointer", display: "block", lineHeight: 0 },
  mediaThumb: { maxWidth: 240, maxHeight: 240, borderRadius: 8, border: "1px solid var(--orca-line)", display: "block" },
  mediaCaption: { fontSize: 11, color: "var(--orca-muted)", marginTop: 4 },
  mediaLoading: { fontSize: 12, color: "var(--orca-muted)", padding: "8px 0" },
  mediaError: { fontSize: 12, color: "#f87171", padding: "8px 0" },
  fileDownloadBtn: { fontSize: 13, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "var(--orca-slate)", color: "var(--orca-ink)", cursor: "pointer", textAlign: "left" },
  voiceRow: { display: "flex", alignItems: "center", gap: 8 },
  voiceDur: { fontSize: 11, color: "var(--orca-muted)", fontFamily: "monospace" },

  // Dialog
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  dialog: { background: "var(--orca-slate)", border: "1px solid var(--orca-line)", borderRadius: 14, padding: "28px 32px", maxWidth: 440, width: "90%" },
  dialogTitle: { fontSize: 17, fontWeight: 700, margin: "0 0 10px" },
  dialogBody: { fontSize: 14, color: "var(--orca-muted)", margin: "0 0 24px", lineHeight: 1.6 },
  dialogBtns: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, border: "1px solid var(--orca-line)", background: "transparent", color: "var(--orca-ink)", cursor: "pointer" },
  confirmDeleteBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontWeight: 600 },
};