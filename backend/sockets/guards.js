const { hashToken } = require('../utils/tokens');
const { INACTIVITY_TIMEOUT_MS } = require('../middleware/authMiddleware');
const { SessionRepository } = require('../repositories/SessionRepository');
const { ConversationRepository } = require('../repositories/ConversationRepository');

// Session- and conversation-table access is delegated to repositories; guards
// hold only the idle-timeout policy and the per-event authorization flow.
const sessionRepo = new SessionRepository();
const conversationRepo = new ConversationRepository();

/**
 * Shared access-control guards for socket handlers (SR-04).
 *
 * Sockets are long-lived while access tokens rotate every 15 minutes, so
 * event handlers cannot re-hash the handshake token to find the session row —
 * after the first POST /api/auth/refresh that hash no longer matches anything.
 * Instead the handshake resolves the token to its sessions.id (stable across
 * refreshes, see routes/auth.js) and every subsequent event re-checks that row
 * for revocation and the 2-hour absolute expiry.
 *
 * The 15-minute idle timeout is deliberately NOT re-enforced per event: an
 * open video call is pure peer-to-peer traffic and generates no HTTP requests,
 * so last_activity can legitimately go stale mid-call. Cutting the signalling
 * channel for "inactivity" would break live calls and the graceful-degradation
 * requirement (SR-15). Revocation (logout, admin termination) and the absolute
 * session cap still apply to live sockets via isSessionLive.
 */

/** Handshake-time: map a raw access token to a live session id, or null. */
async function resolveSession(token) {
  const session = await sessionRepo.findLiveByTokenHash(hashToken(token));
  if (!session) return null;
  const idleMs = Date.now() - new Date(session.last_activity).getTime();
  if (idleMs > INACTIVITY_TIMEOUT_MS) return null;
  return session.id;
}

/** Event-time: is the session this socket connected with still valid? */
async function isSessionLive(sessionId) {
  if (!sessionId) return false;
  return sessionRepo.isLiveById(sessionId);
}

/**
 * Strictly parse a client-supplied conversation id. Only plain positive
 * integers (or digit-only strings) are accepted — objects and arrays are
 * rejected before they ever reach a query placeholder.
 */
function parseConversationId(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && /^\d{1,10}$/.test(raw)) return parseInt(raw, 10);
  return null;
}

/**
 * Full per-event gate: validates the conversation id, confirms the socket's
 * session is still live, and confirms the user is a participant of that
 * conversation (via ConversationRepository). Returns the parsed conversation
 * id, or null if any check fails — callers treat null as access denied.
 */
async function authorizeConversationEvent(socket, rawConversationId) {
  const conversationId = parseConversationId(rawConversationId);
  if (!conversationId) return null;
  if (!(await isSessionLive(socket.sessionId))) return null;
  if (!(await conversationRepo.isParticipant(conversationId, socket.user.id))) return null;
  return conversationId;
}

module.exports = {
  resolveSession,
  isSessionLive,
  parseConversationId,
  authorizeConversationEvent,
};
