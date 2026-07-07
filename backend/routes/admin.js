const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const router = express.Router();
const pool = require('../db/pool').promise();
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { system } = require('../utils/winstonLogger');
const { eventBus, DomainEvent } = require('../domain/events');
const { categorizeAction } = require('../utils/auditCategories');
const { computeSha256, UPLOAD_ROOT } = require('../middleware/upload');
const { decrypt } = require('../utils/messageCipher');

const LOKI_URL = process.env.LOKI_URL;

// ============================================================
// ALL admin routes require a valid JWT for an admin account.
// Client-side guards (RequireRole) are UX only — this is the
// real enforcement boundary. (SR-25: RBAC on every API route)
// ============================================================
router.use(authMiddleware, requireRole('admin'));

// ------------------------------------------------------------------ //
// LOG VIEWER                                                           //
// ------------------------------------------------------------------ //

/**
 * GET /api/admin/logs
 * Query Loki and return structured log entries for the admin UI.
 * The endpoint was previously unauthenticated — now gated by the
 * admin middleware above. Enriches each entry with audit-specific
 * fields (userId, actionType, resourceType, resourceId) so the UI
 * can show a richer audit view (SR-29).
 *
 * FIX: winston-loki does not always emit the meta object (userId,
 * actionType, resourceType, resourceId, ip) as separate top-level JSON
 * keys on the stored line. In practice the line that actually lands in
 * Loki looks like:
 *
 *   {
 *     "ts": "...", "level": "info", "job": "audit",
 *     "msg": "ADMIN_LIST_USERS {\"userId\":5,\"actionType\":\"ADMIN_LIST_USERS\",...}",
 *     "userId": null, "actionType": null, "resourceType": null, "resourceId": null, "ip": "—"
 *   }
 *
 * i.e. the structured meta got appended onto `message` as a stringified
 * JSON suffix instead of being merged into the entry, so the top-level
 * fields really are null and `JSON.parse(line)` alone never recovers them.
 * extractAuditFields() below pulls the trailing `{...}` blob out of msg
 * and parses it, falling back to the top-level keys first in case a
 * future logger version (or an older log line) already has them correct.
 */

// Matches a JSON object appended to the end of a message string, e.g.
// 'ADMIN_LIST_USERS {"userId":5,"actionType":"ADMIN_LIST_USERS",...}'
const TRAILING_JSON_RE = /\{[\s\S]*\}\s*$/;

// Resolve a usable IP from the embedded audit payload, falling back to the
// parsed row; '—' is treated as "no value". Extracted from a nested ternary
// for readability.
function resolveIp(embeddedIp, parsedIp) {
  if (embeddedIp && embeddedIp !== '—') return embeddedIp;
  if (parsedIp && parsedIp !== '—') return parsedIp;
  return null;
}

function extractAuditFields(parsed) {
  // Prefer real top-level fields if a line already has them (forward
  // compatible with a corrected logger).
  const hasTopLevel =
    parsed.userId != null ||
    parsed.actionType != null ||
    parsed.resourceType != null ||
    parsed.resourceId != null;

  if (hasTopLevel) {
    const actionType = parsed.actionType ?? null;
    return {
      userId: parsed.userId ?? null,
      actionType,
      // category was added alongside this fix — older entries written
      // before it won't have it stored, so re-derive from actionType in
      // that case rather than showing a blank category for historical logs.
      category: parsed.category ?? categorizeAction(actionType),
      resourceType: parsed.resourceType ?? null,
      resourceId: parsed.resourceId ?? null,
      ip: parsed.ip && parsed.ip !== '—' ? parsed.ip : null,
      cleanMsg: parsed.message || parsed.msg || null,
    };
  }

  // Otherwise try to recover the fields from a trailing JSON blob inside
  // the message string itself.
  const rawMsg = parsed.message || parsed.msg || '';
  const match = typeof rawMsg === 'string' ? TRAILING_JSON_RE.exec(rawMsg) : null;

  if (match) {
    try {
      const embedded = JSON.parse(match[0]);
      const actionType = embedded.actionType ?? null;
      return {
        userId: embedded.userId ?? null,
        actionType,
        category: embedded.category ?? categorizeAction(actionType),
        resourceType: embedded.resourceType ?? null,
        resourceId: embedded.resourceId ?? null,
        ip: resolveIp(embedded.ip, parsed.ip),
        // Strip the JSON suffix back out so the displayed message is just
        // the human-readable action name, not "ACTION {...raw json...}".
        cleanMsg: rawMsg.slice(0, match.index).trim() || rawMsg,
      };
    } catch {
      // Trailing text looked like JSON but wasn't valid — fall through.
    }
  }

  return {
    userId: null,
    actionType: null,
    category: categorizeAction(null), // 'Other' — no actionType to derive from
    resourceType: null,
    resourceId: null,
    ip: parsed.ip && parsed.ip !== '—' ? parsed.ip : null,
    cleanMsg: rawMsg || null,
  };
}

router.get('/logs', async (req, res) => {
  const { job = '', level = '', search = '', range = '1h' } = req.query;

  let query = '{app="orca"}';
  if (job) query = `{app="orca", job="${job}"}`;
  if (level) query += ` | json | level="${level}"`;
  if (search) query += ` |= \`${search}\``;

  try {
    const response = await fetch(
      `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&since=${range}&limit=200&direction=backward`
    );
    const data = await response.json();

    const logs = [];
    for (const stream of data.data?.result || []) {
      for (const [ts, line] of stream.values) {
        let parsed = {};
        try { parsed = JSON.parse(line); } catch { parsed = { msg: line }; }

        const fields = extractAuditFields(parsed);

        logs.push({
          ts: new Date(Number(ts) / 1e6).toISOString(),
          level: stream.stream?.level || parsed.level || 'info',
          job: stream.stream?.job || 'system',
          msg: fields.cleanMsg || line,
          ip: fields.ip || '—',
          // Audit-specific fields (present on job="audit" entries)
          userId: fields.userId,
          actionType: fields.actionType,
          category: fields.category,
          resourceType: fields.resourceType,
          resourceId: fields.resourceId,
        });
      }
    }

    res.json({ logs });
  } catch (err) {
    system.error('Failed to fetch logs from Loki', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not fetch logs.' });
  }
});

// ------------------------------------------------------------------ //
// USER MANAGEMENT                                                      //
// ------------------------------------------------------------------ //

/**
 * GET /api/admin/users
 * List ALL users with full status columns. The old /api/users was
 * completely unauthenticated and dumped every account — this is the
 * secure replacement. (SR-25, SR-26)
 */
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, role,
              is_verified, is_approved,
              is_soft_locked, soft_lock_until,
              is_hard_locked, failed_attempts,
              created_at, updated_at,
              (email LIKE '%@orca-deleted') AS is_deleted
         FROM users
        ORDER BY created_at DESC`
    );

    eventBus.publish(new DomainEvent('ADMIN_LIST_USERS', {
      userId: req.user.id,
      resourceType: 'user',
      ip: req.ip,
    }));

    res.json({ users: rows });
  } catch (err) {
    system.error('Failed to list users', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not fetch users.' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Soft-delete a user account. Rather than removing the row (which
 * would break FK constraints from messages/conversations), we:
 *   1. Revoke all active sessions immediately.
 *   2. Anonymise PII fields (name, email, contact, bio, password_hash).
 *   3. Hard-lock the account so it can never be recovered.
 * Conversation logs (messages) are intentionally RETAINED so the
 * audit trail of prior conversations is preserved. (FR-05, SR-27)
 */
router.delete('/users/:id', async (req, res) => {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId < 1) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  // Admins cannot delete themselves via this endpoint.
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Administrators cannot delete their own account.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, name, role FROM users WHERE id = ? LIMIT 1',
      [targetId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const target = rows[0];

    // Step 1 — revoke all live sessions so they cannot continue using the app.
    await pool.query(
      'UPDATE sessions SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE',
      [targetId]
    );

    // Step 2 — anonymise the user row. We keep the row itself because messages
    // and conversations hold FK references to it. Clearing password_hash means
    // no credentials can be extracted even if the row is found. The unique
    // tombstone email prevents the slot being re-registered.
    await pool.query(
      `UPDATE users
          SET name           = '[Deleted]',
              email          = CONCAT('deleted_', id, '@orca-deleted'),
              contact_number = NULL,
              bio            = NULL,
              password_hash  = '',
              is_hard_locked = TRUE,
              is_verified    = FALSE,
              is_approved    = FALSE
        WHERE id = ?`,
      [targetId]
    );

    // SR-29: full audit record for account deletion. level: 'warn' so this
    // stands out in the log viewer — irreversible-by-design account
    // deletions warrant more visibility than routine info-level actions.
    eventBus.publish(new DomainEvent('ADMIN_DELETE_USER', {
      userId: req.user.id,
      resourceType: 'user',
      resourceId: targetId,
      ip: req.ip,
      level: 'warn',
    }));

    system.info('Admin deleted user account (soft)', {
      context: 'admin',
      targetUserId: targetId,
      targetRole: target.role,
      adminId: req.user.id,
    });

    res.json({ message: 'User account deleted. Conversation logs retained for audit purposes.' });
  } catch (err) {
    system.error('Failed to delete user', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not delete user.' });
  }
});

/**
 * PATCH /api/admin/users/:id/approve
 * Approve or revoke an Expert account's platform access. This is the
 * "Expert verification decision" referenced in FR-02, FR-05 and SR-09.
 * Only admins can change is_approved (SR-09).
 *
 * On REVOKE: all active sessions for the expert are terminated immediately
 * so they are logged out on their next API request. Without this, a revoked
 * expert stays logged in until their current JWT naturally expires (~15 min).
 *
 * Body: { approved: boolean }
 */
router.patch('/users/:id/approve', async (req, res) => {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId < 1) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  const { approved } = req.body;
  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approved must be a boolean.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, role FROM users WHERE id = ? LIMIT 1',
      [targetId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    if (rows[0].role !== 'expert') {
      return res.status(400).json({ error: 'Only Expert accounts can be approved/revoked.' });
    }

    await pool.query('UPDATE users SET is_approved = ? WHERE id = ?', [approved, targetId]);

    // On revocation: terminate all active sessions immediately so the expert
    // cannot continue using the platform. The authMiddleware now cross-checks
    // the session table on every request, so revoking the rows here causes
    // their next API call to receive a 401 and be logged out. (SR-23, SR-09)
    if (!approved) {
      await pool.query(
        'UPDATE sessions SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE',
        [targetId]
      );
      system.info('Revoked all sessions for de-approved expert', {
        context: 'admin',
        targetUserId: targetId,
        adminId: req.user.id,
      });
    }

    eventBus.publish(new DomainEvent(approved ? 'ADMIN_APPROVE_EXPERT' : 'ADMIN_REVOKE_EXPERT', {
      userId: req.user.id,
      resourceType: 'user',
      resourceId: targetId,
      ip: req.ip,
    }));

    res.json({ message: `Expert ${approved ? 'approved' : 'approval revoked'}.` });
  } catch (err) {
    system.error('Failed to update expert approval', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not update approval status.' });
  }
});

/**
 * PATCH /api/admin/users/:id/unlock
 * Clear a hard lock and reset the failed-attempts counter so the user
 * can attempt to log in again. Hard locks can only be cleared by an
 * admin — they do not expire on their own. (SR-22)
 */
router.patch('/users/:id/unlock', async (req, res) => {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId < 1) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, is_hard_locked FROM users WHERE id = ? LIMIT 1',
      [targetId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    await pool.query(
      `UPDATE users
          SET is_hard_locked  = FALSE,
              is_soft_locked  = FALSE,
              soft_lock_until = NULL,
              failed_attempts = 0
        WHERE id = ?`,
      [targetId]
    );

    eventBus.publish(new DomainEvent('ADMIN_UNLOCK_ACCOUNT', {
      userId: req.user.id,
      resourceType: 'user',
      resourceId: targetId,
      ip: req.ip,
    }));

    res.json({ message: 'Account unlocked.' });
  } catch (err) {
    system.error('Failed to unlock account', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not unlock account.' });
  }
});

// ------------------------------------------------------------------ //
// SESSION MANAGEMENT                                                   //
// ------------------------------------------------------------------ //

/**
 * GET /api/admin/sessions
 * Return all non-revoked, non-expired, non-idle sessions joined to the
 * owning user's name, role and email. (SR-23)
 *
 * A session row only flips revoked=TRUE the next time something actually
 * checks it (authMiddleware on a real request) and finds it's been idle
 * past the 15-minute inactivity timeout — until then it's "idle-expired but
 * not yet discovered". We don't want the admin view showing those as live,
 * so this query also excludes anything idle past the timeout, and lazily
 * marks those rows revoked while we're here so they stop cluttering future
 * reads too.
 */
router.get('/sessions', async (req, res) => {
  try {
    // Lazily clean up sessions that have gone idle past the timeout but
    // haven't been touched by authMiddleware since (e.g. the user just
    // closed the tab). Keeps the table — and this list — accurate without
    // needing a separate cron job.
    await pool.query(
      `UPDATE sessions
          SET revoked = TRUE
        WHERE revoked = FALSE
          AND last_activity < (NOW() - INTERVAL 15 MINUTE)`
    );

    const [rows] = await pool.query(
      `SELECT s.id, s.user_id,
              u.name, u.role, u.email,
              s.source_ip, s.user_agent,
              s.created_at, s.expires_at, s.last_activity
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.revoked = FALSE AND s.expires_at > NOW()
        ORDER BY s.created_at DESC`
    );
    res.json({ sessions: rows });
  } catch (err) {
    system.error('Failed to list sessions', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not fetch sessions.' });
  }
});

/**
 * DELETE /api/admin/sessions/:id
 * Revoke (terminate) any active session immediately. The user's next
 * request will fail JWT verification and they will be logged out.
 * (SR-23: Administrators shall be able to terminate active sessions.)
 */
router.delete('/sessions/:id', async (req, res) => {
  const sessionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(sessionId) || sessionId < 1) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, user_id FROM sessions WHERE id = ? AND revoked = FALSE LIMIT 1',
      [sessionId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Session not found or already revoked.' });
    }

    await pool.query('UPDATE sessions SET revoked = TRUE WHERE id = ?', [sessionId]);

    eventBus.publish(new DomainEvent('ADMIN_TERMINATE_SESSION', {
      userId: req.user.id,
      resourceType: 'session',
      resourceId: sessionId,
      ip: req.ip,
    }));

    res.json({ message: 'Session terminated.' });
  } catch (err) {
    system.error('Failed to terminate session', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not terminate session.' });
  }
});

// ------------------------------------------------------------------ //
// CHAT LOG MANAGEMENT                                                  //
// ------------------------------------------------------------------ //

/**
 * GET /api/admin/conversations
 * List all conversations with participant names and message counts.
 * Gives the admin a searchable overview before opening a log. (FR-12)
 */
router.get('/conversations', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.created_at, c.updated_at,
              w.id AS worker_id, w.name AS worker_name,
              e.id AS expert_id, e.name AS expert_name,
              COUNT(m.id) AS message_count
         FROM conversations c
         JOIN users w ON w.id = c.worker_id
         JOIN users e ON e.id = c.expert_id
         LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id, c.created_at, c.updated_at,
                 w.id, w.name, e.id, e.name
        ORDER BY c.updated_at DESC`
    );
    res.json({ conversations: rows });
  } catch (err) {
    system.error('Failed to list conversations', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not fetch conversations.' });
  }
});

/**
 * GET /api/admin/conversations/:id/messages
 * Read the full chat log for a conversation. Returns a single chronological
 * timeline of ALL content types — text messages, uploaded files/images, and
 * voice messages — not just text, so moderation sees the complete conversation
 * (the media itself is streamed by the two routes below). Each item carries a
 * `type` ('text' | 'file' | 'voice') plus the fields that type needs. This
 * mirrors the UNION shape workers/experts already get from
 * conversationRepository.getConversationHistory. Every admin read is written to
 * the audit trail. (FR-12, SR-03, SR-29)
 */
router.get('/conversations/:id/messages', async (req, res) => {
  const convId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(convId) || convId < 1) {
    return res.status(400).json({ error: 'Invalid conversation ID.' });
  }

  try {
    const [conv] = await pool.query(
      'SELECT id FROM conversations WHERE id = ? LIMIT 1',
      [convId]
    );
    if (!conv.length) return res.status(404).json({ error: 'Conversation not found.' });

    // The timestamp column is aliased `sent_at` for all three types so the
    // client can sort/display uniformly. `id` is only unique WITHIN a type, so
    // the client keys rows by type+id.
    const [rows] = await pool.query(
      `SELECT * FROM (
         SELECT 'text' AS type, m.id AS id, m.sent_at AS sent_at,
                u.id AS sender_id, u.name AS sender_name, u.role AS sender_role,
                m.content AS content,
                NULL AS mime_type, NULL AS original_filename,
                NULL AS file_size_bytes, NULL AS duration_seconds
           FROM messages m
           JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = ?

         UNION ALL

         SELECT 'file', f.id, f.uploaded_at,
                u.id, u.name, u.role,
                NULL,
                f.mime_type, f.original_filename,
                f.file_size_bytes, NULL
           FROM files f
           JOIN users u ON u.id = f.uploader_id
          WHERE f.conversation_id = ?

         UNION ALL

         SELECT 'voice', v.id, v.uploaded_at,
                u.id, u.name, u.role,
                NULL,
                'audio', NULL,
                NULL, v.duration_seconds
           FROM voice_messages v
           JOIN users u ON u.id = v.sender_id
          WHERE v.conversation_id = ?
       ) sub
       ORDER BY sub.sent_at ASC`,
      [convId, convId, convId]
    );

    // Text message content is stored encrypted at rest (SR-06); decrypt for the
    // admin viewer. file/voice rows carry NULL content and pass through.
    const messages = rows.map((r) => ({ ...r, content: decrypt(r.content) }));

    // Log every admin read of a chat log (SR-29).
    eventBus.publish(new DomainEvent('ADMIN_READ_CHAT_LOG', {
      userId: req.user.id,
      resourceType: 'conversation',
      resourceId: convId,
      ip: req.ip,
    }));

    res.json({ messages });
  } catch (err) {
    system.error('Failed to read chat log', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not fetch messages.' });
  }
});

/**
 * GET /api/admin/conversations/:id/files/:fileId
 * GET /api/admin/conversations/:id/voice/:voiceId
 *
 * Stream a file/image or voice message from any conversation for moderation.
 * The worker/expert download routes in routes/files.js are participant-gated
 * (SR-04) and reject admins, so admins need these dedicated, admin-only routes
 * (RBAC already enforced by the router.use at the top of this file — SR-03
 * permits Admins to access any chat log's contents). Integrity is re-verified
 * by checksum on every retrieval (SR-10), exactly as the participant routes do,
 * and every download is audited (SR-29).
 */
async function streamConversationMedia(req, res, { sql, idParam, action, resourceType, fallbackType }) {
  const convId = Number.parseInt(req.params.id, 10);
  const mediaId = Number.parseInt(req.params[idParam], 10);
  if (!Number.isInteger(convId) || convId < 1 || !Number.isInteger(mediaId) || mediaId < 1) {
    return res.status(400).json({ error: 'Invalid identifier.' });
  }

  try {
    // sql is a fixed string chosen by the route below (never user input); the
    // media id and conversation id are the only parameterised values.
    const [rows] = await pool.query(sql, [mediaId, convId]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'Not found.' });

    const absolutePath = path.join(UPLOAD_ROOT, record.storage_path);

    const actualChecksum = await computeSha256(absolutePath);
    if (actualChecksum !== record.checksum_sha256) {
      system.error('Checksum mismatch on admin media retrieval', {
        context: 'admin', resourceType, mediaId, conversationId: convId,
      });
      return res.status(409).json({ error: 'File integrity check failed.' });
    }

    eventBus.publish(new DomainEvent(action, {
      userId: req.user.id,
      resourceType,
      resourceId: mediaId,
      ip: req.ip,
    }));

    res.setHeader('Content-Type', record.mime_type || fallbackType);
    if (record.original_filename) {
      res.setHeader('Content-Disposition', `inline; filename="${record.original_filename}"`);
    }
    fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    system.error('Admin media download failed', { context: 'admin', resourceType, error: err.message });
    res.status(500).json({ error: 'Could not retrieve media.' });
  }
}

router.get('/conversations/:id/files/:fileId', (req, res) =>
  streamConversationMedia(req, res, {
    sql: `SELECT storage_path, checksum_sha256, mime_type, original_filename
            FROM files WHERE id = ? AND conversation_id = ? LIMIT 1`,
    idParam: 'fileId',
    action: 'ADMIN_DOWNLOAD_FILE',
    resourceType: 'file',
    fallbackType: 'application/octet-stream',
  })
);

router.get('/conversations/:id/voice/:voiceId', (req, res) =>
  streamConversationMedia(req, res, {
    sql: `SELECT storage_path, checksum_sha256, NULL AS mime_type, NULL AS original_filename
            FROM voice_messages WHERE id = ? AND conversation_id = ? LIMIT 1`,
    idParam: 'voiceId',
    action: 'ADMIN_DOWNLOAD_VOICE',
    resourceType: 'voice_message',
    fallbackType: 'audio/webm',
  })
);

/**
 * DELETE /api/admin/conversations/:id
 * Permanently delete a chat log and ALL of its content — text messages,
 * uploaded files/images (and their annotations), and voice messages — both the
 * database rows AND the media stored on disk, then the conversation record.
 * Nothing referencing the conversation is left behind. The audit entry is
 * written BEFORE the DELETE statements so it cannot be lost even if the
 * deletion fails partway through. (FR-12, SR-11, SR-27, SR-29, SR-30)
 */
router.delete('/conversations/:id', async (req, res) => {
  const convId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(convId) || convId < 1) {
    return res.status(400).json({ error: 'Invalid conversation ID.' });
  }

  let connection;
  try {
    // Fetch metadata before deletion so the audit entry is meaningful. Counts
    // of each content type are recorded so the deletion log states exactly what
    // was destroyed (SR-29).
    const [conv] = await pool.query(
      `SELECT c.id,
              w.name AS worker_name,
              e.name AS expert_name,
              (SELECT COUNT(*) FROM messages       WHERE conversation_id = c.id) AS message_count,
              (SELECT COUNT(*) FROM files          WHERE conversation_id = c.id) AS file_count,
              (SELECT COUNT(*) FROM voice_messages WHERE conversation_id = c.id) AS voice_count
         FROM conversations c
         JOIN users w ON w.id = c.worker_id
         JOIN users e ON e.id = c.expert_id
        WHERE c.id = ?
        LIMIT 1`,
      [convId]
    );
    if (!conv.length) return res.status(404).json({ error: 'Conversation not found.' });

    const meta = conv[0];

    // Write the audit entry FIRST — if the DELETE fails, the log still
    // records the attempt. The Loki sink is append-only (SR-30).
    // level: 'warn' — permanent chat log deletion warrants standing out.
    eventBus.publish(new DomainEvent('ADMIN_DELETE_CHAT_LOG', {
      userId: req.user.id,
      resourceType: 'conversation',
      resourceId: convId,
      ip: req.ip,
      level: 'warn',
    }));

    // Delete every row tied to the conversation atomically. FK order matters:
    // annotations reference files; messages/files/voice_messages reference the
    // conversation. So annotations first, then the three content tables, then
    // the conversation itself. A transaction ensures we never leave a partial
    // state (e.g. files gone but conversation kept) on an error.
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.query(
      'DELETE a FROM annotations a JOIN files f ON f.id = a.file_id WHERE f.conversation_id = ?',
      [convId]
    );
    await connection.query('DELETE FROM messages WHERE conversation_id = ?', [convId]);
    await connection.query('DELETE FROM files WHERE conversation_id = ?', [convId]);
    await connection.query('DELETE FROM voice_messages WHERE conversation_id = ?', [convId]);
    await connection.query('DELETE FROM conversations WHERE id = ?', [convId]);
    await connection.commit();

    // The authoritative DB records are now gone, so the media is already
    // inaccessible through the app. Remove the stored files from disk too so
    // the pictures and voice recordings are genuinely deleted, not just
    // de-referenced. Everything for a conversation lives under
    // uploads/<conversationId>/ (convId is a validated integer, so no path
    // traversal). Best-effort with force:true: a disk error is logged but does
    // not fail the request, and a conversation that never had uploads is a
    // no-op rather than an error.
    const conversationUploadDir = path.join(UPLOAD_ROOT, String(convId));
    try {
      await fs.promises.rm(conversationUploadDir, { recursive: true, force: true });
    } catch (diskErr) {
      system.error('Chat log deleted but failed to remove uploaded media from disk', {
        context: 'admin', conversationId: convId, error: diskErr.message,
      });
    }

    system.info('Admin permanently deleted chat log', {
      context: 'admin',
      conversationId: convId,
      messageCount: meta.message_count,
      fileCount: meta.file_count,
      voiceCount: meta.voice_count,
      participants: `${meta.worker_name} / ${meta.expert_name}`,
      adminId: req.user.id,
    });

    res.json({ message: 'Chat log permanently deleted.' });
  } catch (err) {
    if (connection) {
      try { await connection.rollback(); } catch { /* already failing; ignore */ }
    }
    system.error('Failed to delete chat log', { context: 'admin', error: err.message });
    res.status(500).json({ error: 'Could not delete chat log.' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;