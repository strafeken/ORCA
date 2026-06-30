import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

/**
 * Route guards.
 *
 * IMPORTANT: these are client-side checks for UX only — they keep users from
 * seeing pages they can't use. They are NOT a security boundary. Every API
 * route must enforce role-based access control on the server regardless of
 * what these guards allow: the client hides the door, the server locks it.
 *
 * Usage in App.jsx:
 *   <Route element={<RequireAuth />}>               // any logged-in user
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 *
 *   <Route element={<RequireRole roles={["admin"]} />}>
 *     <Route path="/admin" element={<AdminConsole />} />
 *   </Route>
 *
 *   <Route element={<RequireAdmin />}>              // admin panel (/adm/*)
 *     <Route path="/admin" element={<AdminDashboard />} />
 *   </Route>
 */

/**
 * RedirectIfAuthed — wrap public auth pages (/login, /register, /forgot-password)
 * so an already-logged-in user is sent to their dashboard instead of seeing the
 * sign-in form again. This fixes the "sign in -> back -> must sign in again"
 * confusion: once authenticated, the login page is simply not reachable.
 */
export function RedirectIfAuthed() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where they were headed so we can return them after login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function RequireRole({ roles }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!roles.includes(user?.role)) {
    // Authenticated but wrong role — send to their own dashboard, not login.
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

/**
 * RequireAdmin — guard for the /adm/* admin panel routes.
 *
 * Differs from RequireRole in that unauthenticated users are sent to the
 * ADMIN login page (/adm/administratorLogin), not the regular /login.
 * Non-admin authenticated users are bounced to /dashboard so they never see
 * a 403 error page — they simply land somewhere appropriate.
 *
 * The real enforcement is server-side (router.use(authMiddleware,
 * requireRole('admin')) in backend/routes/admin.js). This guard is purely UX.
 */
export function RequireAdmin() {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/adm/administratorLogin"
        replace
        state={{ from: location }}
      />
    );
  }
  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
