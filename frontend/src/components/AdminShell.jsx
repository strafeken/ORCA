import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { OrcaWordmark } from "./Brand";
import AdminMenu from "./AdminMenu"; 

/**
 * AdminShell — sidebar layout for every admin panel page.
 *
 * Mounted as the layout element for all /adm/* routes. Provides:
 *   - A fixed left sidebar with navigation links to each admin sub-page.
 *   - The current admin user identity and a sign-out button.
 *   - A main content area that renders the active child route via <Outlet />.
 *
 * This shell is intentionally separate from the regular AppShell so that
 * the admin UI has a visually distinct identity (dark sidebar, no chat nav)
 * and so that a routing mistake can never accidentally expose a regular-user
 * page inside the admin layout.
 *
 * All routes nested inside this shell are further protected by RequireAdmin
 * in App.jsx — this shell itself does not re-verify auth (that is the guard's
 * job) but it redirects admins who log out back to the admin login page.
 */
export default function AdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/adm/administratorLogin", { replace: true });
  }

  const navItems = [
    { to: "/adm/managementDashboard",         icon: "⊞",  label: "Dashboard",      end: true  },
    { to: "/adm/users",     icon: "🫆",  label: "Users"                       },
    { to: "/adm/sessions",  icon: "🔑",  label: "Sessions"                    },
    { to: "/adm/chatlogs",  icon: "💬",  label: "Chat Logs"                   },
    { to: "/adm/logs",      icon: "📋",  label: "Audit Logs"                  },
  ];

  return (
    <div style={s.shell}>
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside style={s.sidebar}>
        {/* Brand */}
        <div style={s.brandRow}>
          <OrcaWordmark size={22} />
          <span style={s.adminBadge}>Admin</span>
        </div>

        {/* Nav */}
        <nav style={s.nav}>
          {navItems.map(({ to, icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                ...s.navLink,
                background: isActive ? "rgba(255,179,35,0.10)" : "transparent",
                color: isActive ? "var(--orca-hi)" : "var(--orca-muted)",
                borderLeft: isActive
                  ? "3px solid var(--orca-hi)"
                  : "3px solid transparent",
              })}
            >
              <span style={s.navIcon}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User + logout */}
        <div style={s.foot}>
          <AdminMenu user={user} onLogout={handleLogout} />
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <main style={s.main}>
        <Outlet />
      </main>
    </div>
  );
}

const s = {
  shell: {
    display: "flex",
    minHeight: "100svh",
    background: "var(--orca-deep)",
  },

  /* Sidebar */
  sidebar: {
    width: 220,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--orca-abyss)",
    borderRight: "1px solid var(--orca-line)",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "20px 18px 16px",
    borderBottom: "1px solid var(--orca-line)",
  },
  adminBadge: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    background: "#2e1d5e",
    color: "#b39ddb",
    padding: "3px 7px",
    borderRadius: 4,
    border: "1px solid #4a3270",
  },

  /* Nav links */
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "12px 8px",
    flexGrow: 1,
  },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transition: "background 0.12s, color 0.12s",
  },
  navIcon: {
    fontSize: 15,
    width: 20,
    textAlign: "center",
  },

  /* Footer */
  foot: {
    borderTop: "1px solid var(--orca-line)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  userInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--orca-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  userRole: {
    fontSize: 10,
    color: "var(--orca-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  signOutBtn: {
    fontSize: 12,
    padding: "7px 12px",
    borderRadius: 7,
    border: "1px solid var(--orca-line)",
    background: "transparent",
    color: "var(--orca-muted)",
    cursor: "pointer",
    textAlign: "center",
    transition: "border-color 0.12s, color 0.12s",
  },

  /* Main content area */
  main: {
    flexGrow: 1,
    padding: "clamp(20px,4vw,40px)",
    overflowY: "auto",
  },
};
