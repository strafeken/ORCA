const express = require('express');
const router = express.Router();
const pool = require('../db/pool').promise();

const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { isParticipant } = require('../utils/conversationRepository');
const { system, audit } = require('../utils/winstonLogger');

const MAX_OVERLAY_JSON_BYTES = 512 * 1024; // 512 KB — generous for vector line data, blocks abuse
const MAX_LINES_PER_OVERLAY = 500;         // sanity cap on number of strokes
const MAX_POINTS_PER_LINE   = 2000;        // sanity cap on points per stroke

function loadFileId(req, res, next) {
  const id = Number.parseInt(req.params.fileId, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid file ID.' });
  }
  req.fileId = id;
  next();
}

/**
 * Loads the parent file + verifies the requester is a participant of the
 * conversation that file belongs to (SR-04/SR-25: authorization checked
 * server-side via the same conversationRepository every other route uses —
 * annotations inherit the access rules of the image they're drawn on).
 * Also confirms the file is actually an image — FR-09 is image annotation,
 * not "annotate any uploaded document".
 */
async function requireImageParticipant(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, conversation_id, mime_type FROM files WHERE id = ? LIMIT 1',
      [req.fileId]
    );
    const file = rows[0];
    if (!file) return res.status(404).json({ error: 'File not found.' });

    const allowed = await isParticipant(file.conversation_id, req.user.id);
    if (!allowed) return res.status(404).json({ error: 'File not found.' });

    if (!file.mime_type.startsWith('image/')) {
      return res.status(400).json({ error: 'Only images can be annotated.' });
    }

    req.file_ = file; // req.file is reserved by Multer elsewhere in the app
    next();
  } catch (err) {
    system.error('Annotation access check failed', { context: 'annotations', error: err.message });
    res.status(500).json({ error: 'Could not verify file access.' });
  }
}

/**
 * validateOverlayData — SR-07: structural validation of the Konva line data before it touches the database.
 *
 * Expected shape: { lines: [ { points: [x, y, x, y, ...], color: '#hex', strokeWidth: N }, ... ] }
 *
 * Returns null on success, or an error string describing what failed.
 */
function validateOverlayData(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return 'overlayData must be a plain object.';
  }

  const { lines } = data;
  if (!Array.isArray(lines)) {
    return 'overlayData.lines must be an array.';
  }
  if (lines.length > MAX_LINES_PER_OVERLAY) {
    return `overlayData.lines exceeds the maximum of ${MAX_LINES_PER_OVERLAY} strokes.`;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line !== 'object' || line === null) {
      return `overlayData.lines[${i}] must be an object.`;
    }

    // points — required, array of finite numbers, even length (x/y pairs)
    if (!Array.isArray(line.points)) {
      return `overlayData.lines[${i}].points must be an array.`;
    }
    if (line.points.length > MAX_POINTS_PER_LINE) {
      return `overlayData.lines[${i}].points exceeds the maximum of ${MAX_POINTS_PER_LINE} values.`;
    }
    if (line.points.length % 2 !== 0) {
      return `overlayData.lines[${i}].points must have an even number of values (x/y pairs).`;
    }
    for (let j = 0; j < line.points.length; j++) {
      if (typeof line.points[j] !== 'number' || !Number.isFinite(line.points[j])) {
        return `overlayData.lines[${i}].points[${j}] must be a finite number.`;
      }
    }

    // color — required, non-empty string
    if (typeof line.color !== 'string' || !line.color.trim()) {
      return `overlayData.lines[${i}].color must be a non-empty string.`;
    }

    // strokeWidth — required, positive finite number
    if (typeof line.strokeWidth !== 'number' || !Number.isFinite(line.strokeWidth) || line.strokeWidth <= 0) {
      return `overlayData.lines[${i}].strokeWidth must be a positive number.`;
    }
  }

  return null; // valid
}

const guard = [authMiddleware, requireRole('worker', 'expert'), loadFileId, requireImageParticipant];

/**
 * POST /:fileId/annotations
 * Body: { overlayData: <Konva-serialisable JSON> }
 * Always INSERTs a new row at version = max(existing)+1. Never updates.
 */
router.post('/:fileId/annotations', ...guard, async (req, res) => {
  const { overlayData } = req.body || {};

  if (overlayData === undefined || overlayData === null) {
    return res.status(400).json({ error: 'overlayData is required.' });
  }

  // SR-07: validate structure before serialising or touching the DB.
  const validationError = validateOverlayData(overlayData);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  let serialised;
  try {
    serialised = JSON.stringify(overlayData);
  } catch {
    return res.status(400).json({ error: 'overlayData must be JSON-serialisable.' });
  }
  if (Buffer.byteLength(serialised, 'utf8') > MAX_OVERLAY_JSON_BYTES) {
    return res.status(413).json({ error: 'Annotation data is too large.' });
  }

  try {
    const [[{ nextVersion }]] = await pool.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM annotations WHERE file_id = ?',
      [req.fileId]
    );

    const [result] = await pool.query(
      'INSERT INTO annotations (file_id, author_id, overlay_data, version) VALUES (?, ?, ?, ?)',
      [req.fileId, req.user.id, serialised, nextVersion]
    );

    const annotation = {
      id: result.insertId,
      file_id: req.fileId,
      author_id: req.user.id,
      author_name: req.user.name,
      version: nextVersion,
      overlay_data: overlayData,
      created_at: new Date().toISOString(),
    };

    audit.log({
      userId: req.user.id,
      actionType: 'ANNOTATION_CREATED',
      resourceType: 'annotation',
      resourceId: result.insertId,
      ip: req.ip,
    });

    req.app.get('io')?.to(`chat:${req.file_.conversation_id}`).emit('chat:annotation', annotation);

    res.status(201).json({ annotation });
  } catch (err) {
    system.error('Failed to save annotation', { context: 'annotations', error: err.message });
    res.status(500).json({ error: 'Could not save annotation.' });
  }
});

/** GET /:fileId/annotations — full version history, oldest first. */
router.get('/:fileId/annotations', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.author_id, u.name AS author_name, a.overlay_data, a.version, a.created_at
         FROM annotations a
         JOIN users u ON u.id = a.author_id
        WHERE a.file_id = ?
        ORDER BY a.version ASC`,
      [req.fileId]
    );
    // overlay_data is a JSON column; mysql2 already parses it to a JS value.
    res.json({ annotations: rows });
  } catch (err) {
    system.error('Failed to list annotations', { context: 'annotations', error: err.message });
    res.status(500).json({ error: 'Could not load annotations.' });
  }
});

module.exports = router;