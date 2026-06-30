import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireAdmin, RedirectIfAuthed } from "./auth/guards";
import AppShell from "./components/AppShell";
import AdminShell from "./components/AdminShell";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import TotpSetup from "./pages/TotpSetup";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";

// Admin pages
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminUserManagement from "./pages/AdminUserManagement";
import AdminSessions from "./pages/AdminSessions";
import AdminChatLogs from "./pages/AdminChatlogs";
import AdminLogs from "./pages/AdminLogs";

/**
 * ROUTE MAP.
 *
 *  Public:           /                       -> Landing
 *                    /login                  -> Login
 *                    /register               -> Register
 *                    /verify-email           -> VerifyEmail
 *                    /forgot-password        -> ForgotPassword
 *                    /reset-password         -> ResetPassword
 *
 *  Admin login:      /adm/administratorLogin -> AdminLogin (public, separate from /login)
 *
 *  Authenticated (any role), inside AppShell:
 *                    /dashboard              -> Dashboard
 *                    /security/2fa           -> TotpSetup
 *
 *  Admin only, inside AdminShell:
 *                    /adm/managementDashboard -> AdminDashboard
 *                    /adm/users              -> AdminUserManagement
 *                    /adm/sessions           -> AdminSessions
 *                    /adm/chatlogs           -> AdminChatLogs
 *                    /adm/logs               -> AdminLogs
 *
 * Security notes:
 *   - RequireAdmin redirects unauthenticated visitors to /adm/administratorLogin
 *     (not /login) and bounces non-admins to /dashboard.
 *   - Server-side RBAC on every /api/admin/* route is the real boundary; the
 *     client guards are UX-only (SR-25).
 */
export default function App() {
  return (
    <Routes>
      {/* ── Public ───────────────────────────────────── */}
      {/* Landing + auth pages: if already logged in, bounce to dashboard so the
          dashboard is the effective home for authenticated users. */}
      <Route element={<RedirectIfAuthed />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>
      <Route path="/verify-email" element={<VerifyEmail />} />

      {/* Admin login — public but separated from the regular login surface */}
      <Route path="/adm/administratorLogin" element={<AdminLogin />} />

      {/* ── Authenticated: any logged-in user ────────── */}
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/security/2fa" element={<TotpSetup />} />

          {/* todo: profile + expert directory */}
          {/* <Route path="/profile" element={<Profile />} /> */}
          {/* <Route path="/experts" element={<ExpertDirectory />} /> */}

          {/* todo: chat + video */}
          {/* <Route path="/chat" element={<Chat />} /> */}
          {/* <Route path="/chat/:conversationId" element={<Chat />} /> */}
        </Route>
      </Route>

      {/* ── Admin only: inside AdminShell ───────────── */}
      {/*
       * RequireAdmin checks isAuthenticated + role === "admin".
       * Unauthenticated → /adm/administratorLogin.
       * Authenticated non-admin → /dashboard.
       */}
      <Route element={<RequireAdmin />}>
        <Route element={<AdminShell />}>
          {/* /adm/managementDashboard is the canonical dashboard URL that AdminLogin redirects to */}
          <Route path="/adm/managementDashboard" element={<AdminDashboard />} />

          {/* Legacy alias kept so existing bookmarks / hardcoded links work */}
          <Route
            path="/adm/homeDashboard"
            element={<Navigate to="/adm/managementDashboard" replace />}
          />

          <Route path="/adm/users"     element={<AdminUserManagement />} />
          <Route path="/adm/sessions"  element={<AdminSessions />} />
          <Route path="/adm/chatlogs"  element={<AdminChatLogs />} />
          <Route path="/adm/logs"      element={<AdminLogs />} />
        </Route>
      </Route>

      {/* ── Fallbacks ────────────────────────────────── */}
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}