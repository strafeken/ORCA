import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../auth/api";

/**
 * ExpertDirectory — workers browse approved experts and start a consultation.
 * Only workers need this page; experts receive inbound requests via their inbox.
 */
export default function ExpertDirectory() {
  const navigate = useNavigate();
  const [experts, setExperts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    apiFetch("/api/experts")
      .then((r) => r.json())
      .then((d) => {
        if (!d.experts) throw new Error(d.error || "Failed to load experts.");
        setExperts(d.experts);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function startConsultation(expertId) {
    setStarting(expertId);
    setError(null);
    try {
      const res = await apiFetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start consultation.");
      navigate(`/consult?c=${data.conversation.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(null);
    }
  }

  function renderExpertList() {
    if (loading) return <p style={s.muted}>Loading experts…</p>;
    if (experts.length === 0) return <p style={s.muted}>No experts are available right now.</p>;
    return (
      <div style={s.grid}>
        {experts.map((ex) => (
          <div key={ex.id} style={s.card}>
            <h2 style={s.name}>{ex.name}</h2>
            {ex.bio && <p style={s.bio}>{ex.bio}</p>}
            {ex.contact_number && (
              <p style={s.contact}>Contact: {ex.contact_number}</p>
            )}
            <button
              style={s.btn}
              disabled={starting === ex.id}
              onClick={() => startConsultation(ex.id)}
            >
              {starting === ex.id ? "Opening…" : "Start consultation"}
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <Link to="/consult" style={s.back}>
        ← Back to consult
      </Link>
      <h1 style={s.h1}>Expert directory</h1>
      <p style={s.sub}>
        Verified experts available for consultation. Start a thread to message or video call.
      </p>

      {error && <div style={s.error}>{error}</div>}

      {renderExpertList()}
    </div>
  );
}

const s = {
  back: { fontSize: 13, color: "var(--orca-hi)", textDecoration: "none", display: "inline-block", marginBottom: 16 },
  h1: { fontSize: 28, fontWeight: 700, margin: "0 0 6px", color: "var(--orca-paper)" },
  sub: { fontSize: 15, color: "var(--orca-muted)", margin: "0 0 24px", lineHeight: 1.5 },
  error: { padding: "12px 14px", borderRadius: 8, background: "#450a0a", color: "#fca5a5", marginBottom: 16, fontSize: 14 },
  muted: { color: "var(--orca-muted)", fontSize: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 },
  card: {
    padding: 22,
    borderRadius: 12,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  name: { fontSize: 18, fontWeight: 600, margin: 0, color: "var(--orca-ink)" },
  bio: { fontSize: 14, color: "var(--orca-muted)", margin: 0, lineHeight: 1.5, flexGrow: 1 },
  contact: { fontSize: 12, color: "var(--orca-faint)", margin: 0 },
  btn: {
    marginTop: 8,
    padding: "10px 0",
    borderRadius: 8,
    border: "none",
    background: "var(--orca-hi)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
};
