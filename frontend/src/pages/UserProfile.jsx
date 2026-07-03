import { useEffect, useState } from "react";
import { apiFetch } from "../auth/api";
import { Link, useSearchParams } from "react-router-dom"; 

const TABS = [
  { id: "personal", label: "Personal info" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data & privacy" },
];

export default function UserProfile() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "personal";
  const [tab, setTab] = useState(initialTab);        
  const [profile, setProfile] = useState(null);       
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  function selectTab(id) {
    setTab(id);
    setSearchParams({ tab: id });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await apiFetch("/api/users/me");
        if (!res.ok) throw new Error("Failed to load profile");
        const data = await res.json();
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p style={s.sub}>Loading profile…</p>;
  if (error) return <p style={{ ...s.sub, color: "var(--orca-danger, #e05a5a)" }}>{error}</p>;

  return (
    <div style={s.layout}>
      <nav style={s.tabList}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            style={{
              ...s.tabItem,
              ...(tab === t.id ? s.tabItemActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div style={s.panel}>
        {tab === "personal" && <PersonalInfo profile={profile} onUpdated={setProfile} />}
        {tab === "security" && <SecurityTab />}
        {tab === "data" && <DataTab />}
      </div>
    </div>
  );
}

function PersonalInfo({ profile, onUpdated }) {
  const [name, setName] = useState(profile.name || "");
  const [contactNumber, setContactNumber] = useState(profile.contact_number || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await apiFetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contact_number: contactNumber, bio }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save changes.");
      onUpdated(data);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
      <h1 style={s.h1}>Personal info</h1>

      <div style={s.field}>
        <label style={s.label}>Display name</label>
        <input
          style={s.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </div>

      <div style={s.field}>
        <label style={s.label}>Contact number</label>
        <input
          style={s.input}
          value={contactNumber}
          onChange={(e) => setContactNumber(e.target.value)}
          maxLength={30}
        />
      </div>

      <div style={s.field}>
        <label style={s.label}>Bio</label>
        <textarea
          style={{ ...s.input, minHeight: 90, resize: "vertical" }}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
        />
      </div>

      <div style={s.readonlyRow}>
        <span style={s.readonlyLabel}>Email</span>
        <span style={s.readonlyValue}>{profile.email}</span>
      </div>
      <div style={s.readonlyRow}>
        <span style={s.readonlyLabel}>Role</span>
        <span style={s.readonlyValue}>{profile.role}</span>
      </div>
      <div style={s.readonlyRow}>
        <span style={s.readonlyLabel}>Verified</span>
        <span style={s.readonlyValue}>{profile.is_verified ? "Yes" : "No"}</span>
      </div>
      <div style={s.readonlyRow}>
        <span style={s.readonlyLabel}>Approved</span>
        <span style={s.readonlyValue}>{profile.is_approved ? "Yes" : "No"}</span>
      </div>
      <div style={s.readonlyRow}>
        <span style={s.readonlyLabel}>Member since</span>
        <span style={s.readonlyValue}>{new Date(profile.created_at).toLocaleDateString()}</span>
      </div>

      {saveError && <p style={{ color: "var(--orca-danger, #e05a5a)", fontSize: 13 }}>{saveError}</p>}
      {saved && <p style={{ color: "var(--orca-hi)", fontSize: 13 }}>Saved.</p>}

      <button type="submit" disabled={saving} className="orca-btn orca-btn--ghost" style={{ marginTop: 12 }}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}


function SecurityTab() {
  const [twoFactor, setTwoFactor] = useState(null);
  const [loading2fa, setLoading2fa] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/users/me/2fa")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setTwoFactor(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading2fa(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={s.h1}>Security</h1>

      <div style={s.card}>
        <Link to="/security/2fa" style={s.summaryRow}>
          <div>
            <div style={s.summaryTitle}>2-Step Verification</div>
            <div style={s.summarySub}>
              {loading2fa
                ? "Loading…"
                : twoFactor?.enabled
                ? `On since ${new Date(twoFactor.since).toLocaleDateString()}`
                : "Off"}
            </div>
          </div>
        </Link>

        <Link to="/security/password" style={s.summaryRow}>
          <div>
            <div style={s.summaryTitle}>Password</div>
            <div style={s.summarySub}>Change your password</div>
          </div>
        </Link>
      </div>
    </div>
  );
}

function DataTab() {
  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={s.h1}>Data &amp; privacy</h1>

      <div style={s.card}>
        <Link to="/account/delete" style={s.summaryRow}>
          <div>
            <div style={s.summaryTitle}>Delete account</div>
            <div style={s.summarySub}>Permanently delete your account and data</div>
          </div>
        </Link>
      </div>
    </div>
  );
}

const s = {
  layout: { display: "flex", gap: 32, maxWidth: 800 },
  tabList: { display: "flex", flexDirection: "column", gap: 4, minWidth: 180 },
  tabItem: {
    textAlign: "left",
    background: "none",
    border: "none",
    color: "var(--orca-muted)",
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
  },
  tabItemActive: {
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    border: "1px solid var(--orca-line)",
  },
  panel: { flex: 1 },
  h1: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.5px", margin: "0 0 20px", color: "var(--orca-paper)" },
  sub: { fontSize: 15, color: "var(--orca-muted)" },
  field: { marginBottom: 16 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "var(--orca-muted)", marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    color: "var(--orca-ink)",
    fontSize: 14,
    fontFamily: "inherit",
  },
  readonlyRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 0",
    borderTop: "1px solid var(--orca-line)",
    fontSize: 13,
  },
  readonlyLabel: { color: "var(--orca-muted)", fontWeight: 600 },
  readonlyValue: { color: "var(--orca-ink)" },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 4px",
    borderBottom: "1px solid var(--orca-line)",
    textDecoration: "none",
    color: "inherit",
  },
  summaryRowBtn: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "16px 4px",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "inherit",
    textAlign: "left",
  },
  summaryTitle: { fontSize: 15, fontWeight: 600, color: "var(--orca-ink)" },
  summarySub: { fontSize: 13, color: "var(--orca-muted)", marginTop: 2 },
  backLink: {
    background: "none",
    border: "none",
    color: "var(--orca-hi)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
    marginBottom: 16,
  },
  card: {
    border: "1px solid var(--orca-line)",
    borderRadius: "var(--orca-radius)",
    background: "var(--orca-slate)",
    padding: "6px 20px",
  },
};