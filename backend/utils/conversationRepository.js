const pool = require('../db/pool');

async function getConversationForParticipant(conversationId, userId) {
  const [rows] = await pool.promise().query(
    'SELECT id, worker_id, expert_id FROM conversations WHERE id = ? AND (worker_id = ? OR expert_id = ?) LIMIT 1',
    [conversationId, userId, userId]
  );
  return rows[0] || null;
}

async function isParticipant(conversationId, userId) {
  return (await getConversationForParticipant(conversationId, userId)) !== null;
}

/**
 * getConversationHistory — initial page on join, newest-N across all three
 * content types (text, file, voice) in chronological order.
 *
 * Returns { messages, hasMore } so the frontend knows whether to show a
 * "load older messages" button.
 */
async function getConversationHistory(conversationId, limit = 50) {
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

  // hasMore: if we got back exactly the limit, there are likely older rows.
  const hasMore = rows.length === boundedLimit;

  // Fetched newest-first so LIMIT keeps the most recent N; reverse to chronological for display.
  return { messages: rows.reverse(), hasMore };
}

/**
 * getConversationPage — load older messages before a given timestamp.
 * Called for every "load more" request from the frontend.
 *
 * @param {number} conversationId
 * @param {string} before — ISO 8601 timestamp; fetch rows strictly older than this
 * @param {number} limit
 * @returns {{ messages: object[], hasMore: boolean }}
 */
async function getConversationPage(conversationId, before, limit = 50) {
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

module.exports = { getConversationForParticipant, isParticipant, getConversationHistory, getConversationPage };