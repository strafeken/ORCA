import { createContext, useContext } from "react";

/**
 * CallGuardContext — a small shared signal so the navbar can tell whether a
 * video call is in progress.
 *
 * The call lives in ConsultThread, but leaving the page via the navbar (nav
 * links, the wordmark, or the account menu) unmounts that component and drops
 * the call — and unlike closing/refreshing the tab (beforeunload) or switching
 * conversations (a window.confirm in ConsultExpert), those in-app navigations
 * had no confirmation. React Router's useBlocker would cover this, but it
 * requires a data router and the app uses <BrowserRouter>, so instead
 * ConsultThread publishes "call active" here and the navbar links confirm
 * before navigating.
 *
 * callActiveRef is a ref (not state) so updating it on every call-status change
 * never re-renders the whole shell.
 */
export const CallGuardContext = createContext(null);

// Shown when the user tries to navigate away mid-call.
export const CALL_LEAVE_MESSAGE =
  "You're in a video call. Leaving this page will end the call. Continue?";

// Safe fallback so a component used outside the provider (or in a test) doesn't
// crash and simply behaves as if no call is active.
const NOOP_GUARD = { callActiveRef: { current: false }, setCallActive: () => {} };

export function useCallGuard() {
  return useContext(CallGuardContext) || NOOP_GUARD;
}
