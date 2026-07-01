import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { apiFetch } from "../auth/api";
import ConsultThread from "../components/ConsultThread";

/**
 * ConsultExpert — Telegram-style consult hub for workers and experts.
 *
 * Workers see past expert chats plus experts they have not contacted yet.
 * Experts see workers who have reached out. Selecting a row opens chat +
 * video inline in the same page (no separate conversation route).
 */
export default function ConsultExpert() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isWorker = user?.role === "worker";

  const [conversations, setConversations] = useState([]);
  const [allExperts, setAllExperts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(null);
  const [search, setSearch] = useState("");

  const selectedId = useMemo(() => {
    const id = parseInt(searchParams.get("c"), 10);
    return Number.isInteger(id) ? id : null;
  }, [searchParams]);

  function selectConversation(id) {
    if (id) {
      setSearchParams({ c: String(id) }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  // `loading` starts true so the mount effect never calls setLoading(true)
  // synchronously — only setLoading(false) in .finally(), like AdminSessions.
  const fetchConsultData = useCallback(() => {
    const requests = [apiFetch("/api/conversations").then((r) => r.json())];
    if (isWorker) {
      requests.push(apiFetch("/api/experts").then((r) => r.json()));
    }
    return Promise.all(requests)
      .then(([convData, expertData]) => {
        if (!convData.conversations) throw new Error(convData.error || "Failed to load conversations.");
        setConversations(convData.conversations);
        if (isWorker) {
          if (!expertData?.experts) throw new Error(expertData.error || "Failed to load experts.");
          setAllExperts(expertData.experts);
        }
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isWorker]);

  useEffect(() => {
    fetchConsultData();
  }, [fetchConsultData]);

  const contactedExpertIds = useMemo(
    () => new Set(conversations.map((c) => c.counterpart_id)),
    [conversations]
  );

  const uncontactedExperts = useMemo(() => {
    if (!isWorker) return [];
    const q = search.trim().toLowerCase();
    return allExperts
      .filter((e) => !contactedExpertIds.has(e.id))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.bio || "").toLowerCase().includes(q));
  }, [allExperts, contactedExpertIds, isWorker, search]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.counterpart_name.toLowerCase().includes(q) ||
        (c.counterpart_bio || "").toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const selected = conversations.find((c) => c.id === selectedId);

  const selectedCounterpart = selected
    ? {
        id: selected.counterpart_id,
        name: selected.counterpart_name,
        role: selected.counterpart_role,
        bio: selected.counterpart_bio,
      }
    : null;

  async function startWithExpert(expert) {
    setStarting(expert.id);
    setError(null);
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId: expert.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start consultation.");

      const row = {
        id: data.conversation.id,
        counterpart_id: expert.id,
        counterpart_name: expert.name,
        counterpart_bio: expert.bio,
        counterpart_role: "expert",
        updated_at: data.conversation.updated_at || new Date().toISOString(),
      };

      setConversations((prev) => {
        if (prev.some((c) => c.id === row.id)) return prev;
        return [row, ...prev];
      });
      selectConversation(row.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(null);
    }
  }

  return (
    <div style={s.layout}>
      <aside style={s.sidebar}>
        <div style={s.sidebarHead}>
          <h1 style={s.sidebarTitle}>{isWorker ? "Consult an expert" : "Worker requests"}</h1>
          {isWorker && (
            <Link to="/experts" style={s.directoryLink}>Full directory</Link>
          )}
        </div>

        <input
          style={s.search}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {error && <div style={s.sidebarError}>{error}</div>}

        {loading ? (
          <p style={s.muted}>Loading…</p>
        ) : (
          <div style={s.list}>
            {filteredConversations.length > 0 && (
              <>
                <p style={s.sectionLabel}>{isWorker ? "Conversations" : "Workers"}</p>
                {filteredConversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    style={{ ...s.row, ...(selectedId === c.id ? s.rowActive : {}) }}
                    onClick={() => selectConversation(c.id)}
                  >
                    <span style={s.avatar}>{c.counterpart_name.charAt(0)}</span>
                    <span style={s.rowText}>
                      <span style={s.rowName}>{c.counterpart_name}</span>
                      {c.counterpart_bio && (
                        <span style={s.rowPreview}>
                          {c.counterpart_bio.length > 40 ? c.counterpart_bio.slice(0, 40) + "…" : c.counterpart_bio}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </>
            )}

            {isWorker && uncontactedExperts.length > 0 && (
              <>
                <p style={s.sectionLabel}>Experts you haven&apos;t contacted</p>
                {uncontactedExperts.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    style={{ ...s.row, ...(starting === ex.id ? s.rowDisabled : {}) }}
                    onClick={() => startWithExpert(ex)}
                    disabled={starting === ex.id}
                  >
                    <span style={{ ...s.avatar, ...s.avatarNew }}>{ex.name.charAt(0)}</span>
                    <span style={s.rowText}>
                      <span style={s.rowName}>{ex.name}</span>
                      {ex.bio && (
                        <span style={s.rowPreview}>
                          {ex.bio.length > 40 ? ex.bio.slice(0, 40) + "…" : ex.bio}
                        </span>
                      )}
                    </span>
                    <span style={s.newBadge}>{starting === ex.id ? "…" : "New"}</span>
                  </button>
                ))}
              </>
            )}

            {!loading && filteredConversations.length === 0 && uncontactedExperts.length === 0 && (
              <p style={s.muted}>
                {isWorker
                  ? "No conversations yet. Pick an expert below or browse the directory."
                  : "No worker requests yet."}
              </p>
            )}
          </div>
        )}
      </aside>

      <main style={s.main}>
        {selected && selectedCounterpart ? (
          <ConsultThread
            key={selectedId}
            conversationId={selectedId}
            counterpart={selectedCounterpart}
          />
        ) : (
          <div style={s.emptyMain}>
            <p style={s.emptyTitle}>Select a consultation</p>
            <p style={s.muted}>
              {isWorker
                ? "Choose an existing conversation or tap a new expert to start messaging."
                : "Choose a worker from the list to reply or start a video call."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

const s = {
  layout: {
    display: "flex",
    height: "calc(100svh - 72px)",
    margin: "-24px clamp(-16px,-4vw,-40px) -48px",
    border: "1px solid var(--orca-line)",
    borderRadius: 12,
    overflow: "hidden",
    background: "var(--orca-slate)",
  },
  sidebar: {
    width: 300,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--orca-line)",
    background: "var(--orca-abyss)",
    minHeight: 0,
  },
  sidebarHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "16px 14px 8px",
    gap: 8,
  },
  sidebarTitle: { fontSize: 16, fontWeight: 700, margin: 0, color: "var(--orca-paper)" },
  directoryLink: { fontSize: 11, color: "var(--orca-hi)", textDecoration: "none", whiteSpace: "nowrap" },
  search: {
    margin: "0 10px 10px",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    fontSize: 13,
  },
  sidebarError: { margin: "0 10px 8px", padding: "8px 10px", borderRadius: 6, background: "#450a0a", color: "#fca5a5", fontSize: 12 },
  list: { flex: 1, overflowY: "auto", padding: "0 6px 12px" },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--orca-faint)",
    padding: "10px 8px 6px",
    margin: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 8px",
    border: "none",
    borderRadius: 8,
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
  },
  rowActive: { background: "var(--orca-slate)" },
  rowDisabled: { opacity: 0.6, cursor: "wait" },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "var(--orca-hi)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  avatarNew: { background: "var(--orca-line)", color: "var(--orca-muted)" },
  rowText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  rowName: { fontSize: 14, fontWeight: 600, color: "var(--orca-ink)" },
  rowPreview: { fontSize: 12, color: "var(--orca-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  newBadge: { fontSize: 10, fontWeight: 700, color: "var(--orca-hi)", flexShrink: 0 },
  muted: { fontSize: 13, color: "var(--orca-muted)", padding: "8px 10px", lineHeight: 1.5 },
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 },
  emptyMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    textAlign: "center",
  },
  emptyTitle: { fontSize: 17, fontWeight: 600, color: "var(--orca-ink)", margin: "0 0 8px" },
};
