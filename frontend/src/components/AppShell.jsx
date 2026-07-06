import { useRef, useCallback, useMemo } from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { OrcaWordmark } from "./Brand";
import UserMenu from "./UserMenu";
import { CallGuardContext, CALL_LEAVE_MESSAGE } from "./callGuard";

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
  const location = useLocation();

  // Shared "a call is active" flag, published by ConsultThread and read by the
  // navbar links + account menu so they can confirm before navigating away.
  const callActiveRef = useRef(false);
  const setCallActive = useCallback((active) => {
    callActiveRef.current = !!active;
  }, []);
  const callGuard = useMemo(() => ({ callActiveRef, setCallActive }), [setCallActive]);

  // Confirm before a navbar navigation that would leave the current page (and
  // thus end an active call). Skips same-page clicks (e.g. "Consult" while
  // already on /consult) so they don't nag. On confirm we clear the flag; the
  // call itself is torn down by ConsultThread's unmount cleanup.
  const guardLeave = useCallback(
    (e, to) => {
      if (callActiveRef.current && to !== location.pathname) {
        if (!window.confirm(CALL_LEAVE_MESSAGE)) {
          e.preventDefault();
          return;
        }
        callActiveRef.current = false;
      }
    },
    [location.pathname]
  );

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
    <CallGuardContext.Provider value={callGuard}>
    <div style={s.shell}>
      <header className="orca-appbar" style={s.bar}>
        <Link
          to="/dashboard"
          className="orca-appbar-brand"
          style={{ textDecoration: "none" }}
          onClick={(e) => guardLeave(e, "/dashboard")}
        >
          <OrcaWordmark size={24} />
        </Link>

        <nav className="orca-appbar-nav" style={s.links}>
          {links
            .filter((l) => l.roles.includes(user?.role))
            .map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={(e) => guardLeave(e, l.to)}
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
    </CallGuardContext.Provider>
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
    // Give the bar its own stacking context above the page content so the
    // user-menu dropdown (an absolutely-positioned child) always paints on top
    // instead of being covered by content below the navbar.
    position: "relative",
    zIndex: 100,
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
