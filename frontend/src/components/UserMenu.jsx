import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * UserMenu — avatar trigger that opens a small account popover.
 */
export default function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const initial = user?.name?.trim()?.[0]?.toUpperCase() || "?";

  useEffect(() => {
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleEscape(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} style={s.root}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={s.avatarBtn}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open && (
        <div style={s.popover} role="menu">
          <div style={s.popoverHeader}>
            <div style={s.avatarBtn}>{initial}</div>
            <div style={{ minWidth: 0 }}>
              <div style={s.popoverName}>{user?.name}</div>
              {user?.email && <div style={s.popoverEmail}>{user.email}</div>}
              <span className="orca-code" style={s.roleTag}>
                {user?.role}
              </span>
            </div>
          </div>

          <div style={s.divider} />

          <Link to="/profile" style={s.menuItem} onClick={() => setOpen(false)}>
            Manage your profile
          </Link>

          <button className="orca-btn orca-btn--ghost" style={{ marginTop: 12 }}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            style={{ ...s.menuItem, ...s.menuItemDanger }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const s = {
  root: { position: "relative" },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "1px solid var(--orca-line)",
    background: "var(--orca-hi)",
    color: "var(--orca-slate)",
    fontWeight: 700,
    fontSize: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 10px)",
    right: 0,
    width: 260,
    background: "var(--orca-slate)",
    border: "1px solid var(--orca-line)",
    borderRadius: "var(--orca-radius)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    padding: 14,
    zIndex: 50,
  },
  popoverHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 },
  popoverName: { fontSize: 14, fontWeight: 600, color: "var(--orca-ink)" },
  popoverEmail: {
    fontSize: 12.5,
    color: "var(--orca-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  roleTag: {
    display: "inline-block",
    marginTop: 4,
    color: "var(--orca-hi)",
    border: "1px solid var(--orca-line)",
    padding: "2px 7px",
    borderRadius: 4,
    fontSize: 11,
  },
  divider: { height: 1, background: "var(--orca-line)", margin: "10px 0" },
  menuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    color: "var(--orca-ink)",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
    padding: "9px 8px",
    borderRadius: 6,
    cursor: "pointer",
  },
  menuItemDanger: { color: "var(--orca-muted)" },
};