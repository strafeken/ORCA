import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { OrcaWordmark } from "./Brand";
import UserMenu from "./UserMenu";

/**
 * AppShell — the layout every authenticated page renders inside.
 *
 * Members mount their pages as nested routes under this shell (see App.jsx),
 * so they get the navbar, the signed-in user, and logout for free. The nav
 * links are role-aware: a worker won't see the Admin link, etc. Add a link
 * here when your page is ready.
 */
export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const links = [
    { to: "/dashboard", label: "Home", roles: ["worker", "expert", "admin"] },
    { to: "/experts", label: "Experts", roles: ["worker"] },
    { to: "/consult", label: "Consult", roles: ["worker", "expert"] },
    { to: "/adm/managementDashboard", label: "Admin", roles: ["admin"] },
  ];

  return (
    <div style={s.shell}>
      <header style={s.bar}>
        <Link to="/dashboard" style={{ textDecoration: "none" }}>
          <OrcaWordmark size={24} />
        </Link>

        <nav style={s.links}>
          {links
            .filter((l) => l.roles.includes(user?.role))
            .map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                style={({ isActive }) => ({
                  ...s.link,
                  color: isActive ? "var(--orca-hi)" : "var(--orca-muted)",
                })}
              >
                {l.label}
              </NavLink>
            ))}
        </nav>

        {/* <div style={s.userBox}>
          <span style={s.userName}>{user?.name}</span>
          <span className="orca-code" style={s.roleTag}>
            {user?.role}
          </span>
          <button onClick={handleLogout} className="orca-btn orca-btn--ghost" style={{ minHeight: 40 }}>
            Sign out
          </button>
        </div> */}
        <UserMenu user={user} onLogout={handleLogout} />
      </header>

      <main style={s.content}>
        <Outlet />
      </main>
    </div>
  );
}

const s = {
  shell: { minHeight: "100svh", display: "flex", flexDirection: "column" },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    padding: "12px clamp(16px,4vw,40px)",
    borderBottom: "1px solid var(--orca-line)",
    background: "var(--orca-slate)",
    flexWrap: "wrap",
  },
  links: { display: "flex", gap: 22, flexGrow: 1 },
  link: { fontSize: 15, fontWeight: 600, textDecoration: "none" },
  userBox: { display: "flex", alignItems: "center", gap: 12 },
  userName: { fontSize: 14, color: "var(--orca-ink)", fontWeight: 600 },
  roleTag: {
    color: "var(--orca-hi)",
    border: "1px solid var(--orca-line)",
    padding: "3px 8px",
    borderRadius: 4,
  },
  content: { flexGrow: 1, padding: "clamp(24px,5vw,48px)" },
};
