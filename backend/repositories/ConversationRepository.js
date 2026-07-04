const pool = require('../db/pool');

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
}

module.exports = { ConversationRepository };
