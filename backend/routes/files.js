const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const pool = require('../db/pool').promise();

const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { isParticipant } = require('../utils/conversationRepository');
const { sanitizeFilename } = require('../utils/sanitize');
const { system } = require('../utils/winstonLogger');
const { eventBus, DomainEvent } = require('../domain/events');
const {
  uploadFile,
  uploadVoice,
  verifyFileType,
  computeSha256,
  deleteFileSafely,
  conversationDir,
  ALLOWED_FILE_MIME,
  UPLOAD_ROOT,
} = require('../middleware/upload');
const { probeAndTranscode } = require('../utils/audio');

/**
 * routes/files.js — conversation-scoped file & voice-message endpoints.
 * Mounted at /api/conversations in app.js, so full paths are:
 *
 *   POST /api/conversations/:id/files                upload a file
 *   GET  /api/conversations/:id/files                list files
 *   GET  /api/conversations/:id/files/:fileId         download a file
 *   POST /api/conversations/:id/voice                 upload a voice message
 *   GET  /api/conversations/:id/voice                 list voice messages
 *   GET  /api/conversations/:id/voice/:voiceId         download a voice message
 */

// ---------------------------------------------------------------------------
// Shared param-handling middleware
// ---------------------------------------------------------------------------

/** Parses :id into req.conversationId (validated positive integer). */
function loadConversationId(req, res, next) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid conversation ID.' });
  }
  req.conversationId = id;
  next();
}

async function requireParticipant(req, res, next) {
  try {
    const allowed = await isParticipant(req.conversationId, req.user.id);
    if (!allowed) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    next();
  } catch (err) {
    system.error('Participant check failed', { context: 'files', error: err.message });
    res.status(500).json({ error: 'Could not verify conversation access.' });
  }
}

const guard = [authMiddleware, requireRole('worker', 'expert'), loadConversationId, requireParticipant];

// ---------------------------------------------------------------------------
// Files (photos / documents)
// ---------------------------------------------------------------------------

router.post('/:id/files', ...guard, uploadFile.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided, or it failed validation (type/size).' });
  }

  const diskPath = req.file.path;

  try {
    const detected = await verifyFileType(diskPath, ALLOWED_FILE_MIME);
    if (!detected) {
      deleteFileSafely(diskPath);
      return res.status(400).json({ error: 'File content does not match an allowed type.' });
    }

    const checksum = await computeSha256(diskPath);
    const displayName = sanitizeFilename(req.file.originalname);
    const relativeStoragePath = path.join(String(req.conversationId), 'files', req.file.filename);

    const [result] = await pool.query(
      `INSERT INTO files
         (conversation_id, uploader_id, original_filename, storage_path, mime_type, file_size_bytes, checksum_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.conversationId, req.user.id, displayName, relativeStoragePath, detected.mime, req.file.size, checksum]
    );

    const fileRecord = {
      type: 'file',
      id: result.insertId,
      conversation_id: req.conversationId,
      sender_id: req.user.id,      // normalised to match the history query alias
      sender_name: req.user.name,
      uploader_id: req.user.id,    // kept for any consumers still reading this field
      uploader_name: req.user.name,
      original_filename: displayName,
      mime_type: detected.mime,
      file_size_bytes: req.file.size,
      uploaded_at: new Date().toISOString(),
    };

    eventBus.publish(new DomainEvent('FILE_UPLOADED', {
      userId: req.user.id,
      resourceType: 'file',
      resourceId: result.insertId,
      ip: req.ip,
    }));

    req.app.get('io')?.to(`chat:${req.conversationId}`).emit('chat:file', fileRecord);

    res.status(201).json({ file: fileRecord });
  } catch (err) {
    deleteFileSafely(diskPath);
    system.error('File upload failed', { context: 'files', error: err.message });
    res.status(500).json({ error: 'Could not process the uploaded file.' });
  }
});

/** GET /:id/files — list file metadata for this conversation. */
router.get('/:id/files', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.uploader_id, u.name AS uploader_name, f.original_filename,
              f.mime_type, f.file_size_bytes, f.uploaded_at
         FROM files f
         JOIN users u ON u.id = f.uploader_id
        WHERE f.conversation_id = ?
        ORDER BY f.uploaded_at ASC`,
      [req.conversationId]
    );
    res.json({ files: rows });
  } catch (err) {
    system.error('Failed to list files', { context: 'files', error: err.message });
    res.status(500).json({ error: 'Could not load files.' });
  }
});

/** GET /:id/files/:fileId — stream a file back, re-verifying the checksum on every retrieval */
router.get('/:id/files/:fileId', ...guard, async (req, res) => {
  const fileId = Number.parseInt(req.params.fileId, 10);
  if (!Number.isInteger(fileId) || fileId < 1) {
    return res.status(400).json({ error: 'Invalid file ID.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT storage_path, mime_type, original_filename, checksum_sha256
         FROM files WHERE id = ? AND conversation_id = ? LIMIT 1`,
      [fileId, req.conversationId]
    );
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'File not found.' });

    const absolutePath = path.join(UPLOAD_ROOT, record.storage_path);

    const actualChecksum = await computeSha256(absolutePath);
    if (actualChecksum !== record.checksum_sha256) {
      system.error('Checksum mismatch on file retrieval', {
        context: 'files', fileId, conversationId: req.conversationId,
      });
      return res.status(409).json({ error: 'File integrity check failed. Contact an administrator.' });
    }

    // SR-29: audit every file download so access to sensitive site media is traceable.
    eventBus.publish(new DomainEvent('FILE_DOWNLOADED', {
      userId: req.user.id,
      resourceType: 'file',
      resourceId: fileId,
      ip: req.ip,
    }));

    res.setHeader('Content-Type', record.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${record.original_filename}"`);
    fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    system.error('File download failed', { context: 'files', error: err.message });
    res.status(500).json({ error: 'Could not retrieve file.' });
  }
});

// ---------------------------------------------------------------------------
// Voice messages
// ---------------------------------------------------------------------------

/**
 * POST /:id/voice
 * Raw browser recording -> FFmpeg validate+transcode (utils/audio.js) ->
 * checksum the TRANSCODED output -> DB row -> realtime notify.
 */
router.post('/:id/voice', ...guard, uploadVoice.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio provided, or it failed validation (type/size).' });
  }

  const rawPath = req.file.path;
  const outputDir = conversationDir(req.conversationId, 'voice');
  const outputFilename = path.basename(rawPath, path.extname(rawPath)) + '.webm';
  const outputPath = path.join(outputDir, outputFilename);

  try {
    const { durationSeconds } = await probeAndTranscode(rawPath, outputPath);
    deleteFileSafely(rawPath); // raw upload no longer needed once transcoded

    const checksum = await computeSha256(outputPath);
    const relativeStoragePath = path.join(String(req.conversationId), 'voice', outputFilename);

    const [result] = await pool.query(
      `INSERT INTO voice_messages
         (conversation_id, sender_id, storage_path, duration_seconds, checksum_sha256)
       VALUES (?, ?, ?, ?, ?)`,
      [req.conversationId, req.user.id, relativeStoragePath, durationSeconds, checksum]
    );

    const voiceRecord = {
      type: 'voice',
      id: result.insertId,
      conversation_id: req.conversationId,
      sender_id: req.user.id,
      sender_name: req.user.name,
      duration_seconds: durationSeconds,
      uploaded_at: new Date().toISOString(),
    };

    eventBus.publish(new DomainEvent('VOICE_MESSAGE_UPLOADED', {
      userId: req.user.id,
      resourceType: 'voice_message',
      resourceId: result.insertId,
      ip: req.ip,
    }));

    req.app.get('io')?.to(`chat:${req.conversationId}`).emit('chat:voice', voiceRecord);

    res.status(201).json({ voiceMessage: voiceRecord });
  } catch (err) {
    deleteFileSafely(rawPath);
    deleteFileSafely(outputPath);
    const status = err.message === 'VOICE_TOO_LONG' ? 400 : err.message === 'INVALID_AUDIO' ? 400 : 500;
    const message =
      err.message === 'VOICE_TOO_LONG'
        ? 'Voice message is too long.'
        : err.message === 'INVALID_AUDIO'
          ? 'Could not process that recording as audio.'
          : 'Could not process the uploaded voice message.';
    if (status === 500) system.error('Voice upload failed', { context: 'files', error: err.message });
    res.status(status).json({ error: message });
  }
});

/** GET /:id/voice — list voice message metadata for this conversation. */
router.get('/:id/voice', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.sender_id, u.name AS sender_name, v.duration_seconds, v.uploaded_at
         FROM voice_messages v
         JOIN users u ON u.id = v.sender_id
        WHERE v.conversation_id = ?
        ORDER BY v.uploaded_at ASC`,
      [req.conversationId]
    );
    res.json({ voiceMessages: rows });
  } catch (err) {
    system.error('Failed to list voice messages', { context: 'files', error: err.message });
    res.status(500).json({ error: 'Could not load voice messages.' });
  }
});

/** GET /:id/voice/:voiceId — stream a voice message, checksum-verified. */
router.get('/:id/voice/:voiceId', ...guard, async (req, res) => {
  const voiceId = Number.parseInt(req.params.voiceId, 10);
  if (!Number.isInteger(voiceId) || voiceId < 1) {
    return res.status(400).json({ error: 'Invalid voice message ID.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT storage_path, checksum_sha256
         FROM voice_messages WHERE id = ? AND conversation_id = ? LIMIT 1`,
      [voiceId, req.conversationId]
    );
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'Voice message not found.' });

    const absolutePath = path.join(UPLOAD_ROOT, record.storage_path);

    const actualChecksum = await computeSha256(absolutePath);
    if (actualChecksum !== record.checksum_sha256) {
      system.error('Checksum mismatch on voice retrieval', {
        context: 'files', voiceId, conversationId: req.conversationId,
      });
      return res.status(409).json({ error: 'File integrity check failed. Contact an administrator.' });
    }

    // SR-29: audit every voice message download so access to recordings is traceable.
    eventBus.publish(new DomainEvent('VOICE_MESSAGE_DOWNLOADED', {
      userId: req.user.id,
      resourceType: 'voice_message',
      resourceId: voiceId,
      ip: req.ip,
    }));

    res.setHeader('Content-Type', 'audio/webm');
    fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    system.error('Voice download failed', { context: 'files', error: err.message });
    res.status(500).json({ error: 'Could not retrieve voice message.' });
  }
});

module.exports = router;