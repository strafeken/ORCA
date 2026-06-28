import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireRole } from "./auth/guards";
import AppShell from "./components/AppShell";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import TotpSetup from "./pages/TotpSetup";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";

/**
 * ROUTE MAP.
 *
 *  Public:        /                  -> Landing
 *                 /login             -> Login (wired)
 *                 /register          -> Register (wired)
 *                 /verify-email      -> VerifyEmail (from email link)
 *                 /forgot-password   -> ForgotPassword
 *                 /reset-password    -> ResetPassword (from email link)
 *
 *  Authenticated (any role), inside AppShell:
 *                 /dashboard         -> Dashboard
 *                 /security/2fa      -> TotpSetup
 *
 *  Admin only:    /admin             -> admin console (todo)
 */
export default function App() {
  return (
    <Routes>
      {/* ---- Public ---- */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* ---- Authenticated: any logged-in user ---- */}
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

      {/* ---- Admin only ---- */}
      <Route element={<RequireRole roles={["admin"]} />}>
        <Route element={<AppShell />}>
          {/* todo: admin console */}
          {/* <Route path="/admin" element={<AdminConsole />} /> */}
        </Route>
      </Route>

      {/* ---- Fallbacks ---- */}
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
