import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export default function AdminMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const initial = user?.name?.trim()?.[0]?.toUpperCase() || "?";

  useEffect(() => {
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
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
      {open && (
        <div className="orca-admin-usermenu-popover" style={s.popover} role="menu">
          <div style={s.popoverHeader}>
            <div style={s.avatarBtn}>{initial}</div>
            <div style={{ minWidth: 0 }}>
              <div style={s.popoverName}>{user?.name}</div>
              <span style={s.roleTag}>Administrator</span>
            </div>
          </div>
          <div style={s.divider} />
          <Link to="/adm/security/password" style={s.menuItem} onClick={() => setOpen(false)}>
            Change password
          </Link>
          <Link to="/adm/security/2fa" style={s.menuItem} onClick={() => setOpen(false)}>
            Two-factor authentication
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            style={s.menuItem}
          >
            Sign out
          </button>
        </div>
      )}

      <button onClick={() => setOpen((v) => !v)} style={s.trigger} aria-haspopup="true" aria-expanded={open}>
        <div style={s.avatarBtn}>{initial}</div>
        <div className="orca-admin-usermenu-text" style={s.triggerText}>
          <span style={s.userName}>{user?.name}</span>
          <span style={s.userRole}>administrator</span>
        </div>
      </button>
    </div>
  );
}

const s = {
  root: { position: "relative" },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: "none",
    border: "1px solid var(--orca-line)",
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
  },
  avatarBtn: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "var(--orca-hi)",
    color: "var(--orca-abyss, #0d0f15)",
    fontWeight: 700,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  triggerText: { display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--orca-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 130,
  },
  userRole: { fontSize: 10, color: "var(--orca-muted)", textTransform: "uppercase", letterSpacing: "0.06em" },
  popover: {
    // Positioning (top/bottom/left/right) lives in orca.css under
    // .orca-admin-usermenu-popover so a media query can flip the menu from
    // opening upward (desktop sidebar) to downward (mobile top bar).
    position: "absolute",
    width: 220,
    maxWidth: "calc(100vw - 24px)",
    background: "var(--orca-slate)",
    border: "1px solid var(--orca-line)",
    borderRadius: "var(--orca-radius)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    padding: 12,
    zIndex: 200,
  },
  popoverHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  popoverName: { fontSize: 13, fontWeight: 600, color: "var(--orca-ink)" },
  roleTag: { fontSize: 11, color: "var(--orca-hi)" },
  divider: { height: 1, background: "var(--orca-line)", margin: "8px 0" },
  menuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    color: "var(--orca-ink)",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 6px",
    borderRadius: 6,
    cursor: "pointer",
  },
};