/**
 * auditCategories.js — maps every audit actionType to one of five categories:
 * Create, Read, Update, Delete, Login.
 *
 * Why this exists: audit log entries only ever carried Winston's severity
 * `level` (info/warn/error), which says nothing about *what kind* of action
 * happened. For an audit trail, "what kind of operation was this" (CRUD +
 * Login) is the far more useful axis to filter/group by — e.g. "show me
 * every Delete" or "show me every Login attempt today".
 *
 * This is kept as a single shared map (rather than duplicated in the logger
 * and the admin route) so adding a new actionType anywhere in the app means
 * updating exactly one file. If a new audit.log() call uses an actionType
 * not listed here, categorizeAction() falls back to 'Other' rather than
 * throwing — better to surface a visibly-uncategorized entry than to break
 * logging for an action someone forgot to add to this map.
 */

const CATEGORY = {
  CREATE: 'Create',
  READ: 'Read',
  UPDATE: 'Update',
  DELETE: 'Delete',
  LOGIN: 'Login',
  OTHER: 'Other',
};

// Every actionType currently emitted via audit.log(...) across the codebase
// (backend/routes/auth.js, authExtras.js, admin.js), mapped to its category.
const ACTION_CATEGORY_MAP = {
  // ── Create ──────────────────────────────────────────────────────────
  register: CATEGORY.CREATE,
  // SR-29 explicitly names file uploads as a sensitive action requiring an audit trail entry; voice messages and
  // annotations are the same category of action (a new artifact created inside a conversation) so they're grouped here too.
  FILE_UPLOADED: CATEGORY.CREATE,
  VOICE_MESSAGE_UPLOADED: CATEGORY.CREATE,
  ANNOTATION_CREATED: CATEGORY.CREATE,

  // ── Read ────────────────────────────────────────────────────────────
  ADMIN_LIST_USERS: CATEGORY.READ,
  ADMIN_READ_CHAT_LOG: CATEGORY.READ,
  // Downloading a stored artifact is a read of conversation content.
  FILE_DOWNLOADED: CATEGORY.READ,
  VOICE_MESSAGE_DOWNLOADED: CATEGORY.READ,
  // Admin viewing conversation media from the chat-log moderation screen.
  ADMIN_DOWNLOAD_FILE: CATEGORY.READ,
  ADMIN_DOWNLOAD_VOICE: CATEGORY.READ,

  // ── Update ──────────────────────────────────────────────────────────
  email_verified: CATEGORY.UPDATE,
  password_reset_completed: CATEGORY.UPDATE,
  totp_enabled: CATEGORY.UPDATE,
  totp_disabled: CATEGORY.UPDATE,
  // Self-service profile / credential changes (FR-04). Both the successful
  // change and a failed attempt are Update actions on the user's own account —
  // previously unmapped, so they were falling through to 'Other'.
  profile_updated: CATEGORY.UPDATE,
  password_changed: CATEGORY.UPDATE,
  password_change_failed: CATEGORY.UPDATE,
  ADMIN_APPROVE_EXPERT: CATEGORY.UPDATE,
  ADMIN_REVOKE_EXPERT: CATEGORY.UPDATE,
  ADMIN_UNLOCK_ACCOUNT: CATEGORY.UPDATE,
  // Account lockouts mutate the account's lock state — categorized as
  // Update (not Login) since the lock itself is a state change applied TO
  // the account, distinct from the login_failed attempt that triggered it.
  ACCOUNT_SOFT_LOCKED: CATEGORY.UPDATE,
  ACCOUNT_HARD_LOCKED: CATEGORY.UPDATE,

  // ── Delete ──────────────────────────────────────────────────────────
  ADMIN_DELETE_USER: CATEGORY.DELETE,
  ADMIN_DELETE_CHAT_LOG: CATEGORY.DELETE,
  // Self-service account deletion (FR-04/FR-05), its failed-password attempt,
  // and an admin being refused self-deletion at the endpoint.
  account_deleted: CATEGORY.DELETE,
  account_delete_failed: CATEGORY.DELETE,
  account_delete_denied_admin: CATEGORY.DELETE,

  // ── Login (covers the full session/credential lifecycle: login attempts,
  //    logout, session termination, and the password-reset *request* step —
  //    grouped here rather than under Update since nothing is being mutated
  //    yet at that point, just a reset flow being initiated) ─────────────
  login_success: CATEGORY.LOGIN,
  login_failed: CATEGORY.LOGIN,
  admin_login_success: CATEGORY.LOGIN,
  admin_login_failed: CATEGORY.LOGIN,
  admin_login_denied_non_admin: CATEGORY.LOGIN,
  admin_used_public_login: CATEGORY.LOGIN,
  totp_failed: CATEGORY.LOGIN,
  USER_LOGOUT: CATEGORY.LOGIN,
  password_reset_requested: CATEGORY.LOGIN,
  ADMIN_TERMINATE_SESSION: CATEGORY.LOGIN,
  // Re-authentication before a sensitive operation is a credential check,
  // grouped with the rest of the session/credential lifecycle.
  reauth_failed: CATEGORY.LOGIN,
  // A login refused because the account already has an active session
  // (SR-23 one-session-per-user enforcement).
  login_blocked_active_session: CATEGORY.LOGIN,
  admin_login_blocked_active_session: CATEGORY.LOGIN,
};

/**
 * Look up the CRUD+Login category for a given actionType.
 * Falls back to 'Other' for anything not in the map (new/forgotten
 * actionTypes), and to 'Other' for null/undefined (non-audit log lines —
 * the category column is meaningless for system-job entries anyway).
 */
function categorizeAction(actionType) {
  if (!actionType) return CATEGORY.OTHER;
  return ACTION_CATEGORY_MAP[actionType] || CATEGORY.OTHER;
}

module.exports = { CATEGORY, ACTION_CATEGORY_MAP, categorizeAction };