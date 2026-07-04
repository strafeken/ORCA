const pool = require('../db/pool');

// Soft-deleted accounts have their email suffixed with this marker; a
// conversation with a deleted participant must never surface.
const DELETED_EMAIL_SUFFIX = '@orca-deleted';

/**
 * ConversationRepository — data access for conversations and their unified
 * message history (text + file + voice). Formalizes the previous
 * utils/conversationRepository module into a class (Repository pattern); the
 * old module now delegates here so existing importers are unaffected.
 *
 * SQL is unchanged from the original module.
 */
class ConversationRepository {
  async getForParticipant(conversationId, userId) {
    const [rows] = await pool.promise().query(
      'SELECT id, worker_id, expert_id FROM conversations WHERE id = ? AND (worker_id = ? OR expert_id = ?) LIMIT 1',
      [conversationId, userId, userId]
    );
    return rows[0] || null;
  }

  async isParticipant(conversationId, userId) {
    return (await this.getForParticipant(conversationId, userId)) !== null;
  }

  /**
   * Newest-N history across text/file/voice in chronological order.
   * Returns { messages, hasMore } so the UI knows whether to offer "load older".
   */
  async getHistory(conversationId, limit = 50) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
    const [rows] = await pool.promise().query(
      `SELECT * FROM (
         SELECT 'text' AS type, m.id AS id, m.sent_at AS ts, m.sender_id AS sender_id,
                u.name AS sender_name, m.content AS content,
                NULL AS file_id, NULL AS mime_type, NULL AS original_filename,
                NULL AS file_size_bytes, NULL AS duration_seconds
           FROM messages m
           JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = ?

         UNION ALL

         SELECT 'file', f.id, f.uploaded_at, f.uploader_id,
                u.name, NULL,
                f.id, f.mime_type, f.original_filename,
                f.file_size_bytes, NULL
           FROM files f
           JOIN users u ON u.id = f.uploader_id
          WHERE f.conversation_id = ?

         UNION ALL

         SELECT 'voice', v.id, v.uploaded_at, v.sender_id,
                u.name, NULL,
                v.id, 'audio', NULL,
                NULL, v.duration_seconds
           FROM voice_messages v
           JOIN users u ON u.id = v.sender_id
          WHERE v.conversation_id = ?
       ) sub
       ORDER BY sub.ts DESC
       LIMIT ?`,
      [conversationId, conversationId, conversationId, boundedLimit]
    );
    const hasMore = rows.length === boundedLimit;
    return { messages: rows.reverse(), hasMore };
  }

  /** Load older messages before a given ISO timestamp (pagination). */
  async getPage(conversationId, before, limit = 50) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
    const [rows] = await pool.promise().query(
      `SELECT * FROM (
         SELECT 'text' AS type, m.id AS id, m.sent_at AS ts, m.sender_id AS sender_id,
                u.name AS sender_name, m.content AS content,
                NULL AS file_id, NULL AS mime_type, NULL AS original_filename,
                NULL AS file_size_bytes, NULL AS duration_seconds
           FROM messages m
           JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = ?

         UNION ALL

         SELECT 'file', f.id, f.uploaded_at, f.uploader_id,
                u.name, NULL,
                f.id, f.mime_type, f.original_filename,
                f.file_size_bytes, NULL
           FROM files f
           JOIN users u ON u.id = f.uploader_id
          WHERE f.conversation_id = ?

         UNION ALL

         SELECT 'voice', v.id, v.uploaded_at, v.sender_id,
                u.name, NULL,
                v.id, 'audio', NULL,
                NULL, v.duration_seconds
           FROM voice_messages v
           JOIN users u ON u.id = v.sender_id
          WHERE v.conversation_id = ?
       ) sub
       WHERE sub.ts < ?
       ORDER BY sub.ts DESC
       LIMIT ?`,
      [conversationId, conversationId, conversationId, before, boundedLimit]
    );
    const hasMore = rows.length === boundedLimit;
    return { messages: rows.reverse(), hasMore };
  }

  // ---- HTTP inbox / detail / creation (routes/conversations.js) ----

  /** Full conversation + both parties' details, participant-scoped and excluding deleted accounts. */
  async findDetailedForUser(conversationId, userId) {
    const [rows] = await pool.promise().query(
      `SELECT c.id, c.worker_id, c.expert_id, c.created_at, c.updated_at,
              w.name AS worker_name, w.email AS worker_email,
              e.name AS expert_name, e.email AS expert_email, e.bio AS expert_bio
         FROM conversations c
         JOIN users w ON w.id = c.worker_id
         JOIN users e ON e.id = c.expert_id
        WHERE c.id = ?
          AND (c.worker_id = ? OR c.expert_id = ?)
          AND w.email NOT LIKE ?
          AND e.email NOT LIKE ?
        LIMIT 1`,
      [conversationId, userId, userId, `%${DELETED_EMAIL_SUFFIX}`, `%${DELETED_EMAIL_SUFFIX}`]
    );
    return rows[0] || null;
  }

  /** Inbox list for a worker (counterpart = expert) or an expert (counterpart = worker). */
  async listInbox(userId, isWorker) {
    const [rows] = await pool.promise().query(
      isWorker
        ? `SELECT c.id, c.created_at, c.updated_at,
                  u.id AS counterpart_id, u.name AS counterpart_name,
                  u.bio AS counterpart_bio, 'expert' AS counterpart_role
             FROM conversations c
             JOIN users u ON u.id = c.expert_id
            WHERE c.worker_id = ?
              AND u.email NOT LIKE ?
            ORDER BY c.updated_at DESC`
        : `SELECT c.id, c.created_at, c.updated_at,
                  u.id AS counterpart_id, u.name AS counterpart_name,
                  u.bio AS counterpart_bio, 'worker' AS counterpart_role
             FROM conversations c
             JOIN users u ON u.id = c.worker_id
            WHERE c.expert_id = ?
              AND u.email NOT LIKE ?
            ORDER BY c.updated_at DESC`,
      [userId, `%${DELETED_EMAIL_SUFFIX}`]
    );
    return rows;
  }

  async findByWorkerAndExpert(workerId, expertId) {
    const [rows] = await pool.promise().query(
      'SELECT id FROM conversations WHERE worker_id = ? AND expert_id = ? LIMIT 1',
      [workerId, expertId]
    );
    return rows[0] || null;
  }

  async create(workerId, expertId) {
    const [result] = await pool.promise().query(
      'INSERT INTO conversations (worker_id, expert_id) VALUES (?, ?)',
      [workerId, expertId]
    );
    return result.insertId;
  }
}

module.exports = { ConversationRepository };
