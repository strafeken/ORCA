const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { system } = require('../utils/winstonLogger');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

// ---- Allowlists ----
const ALLOWED_IMAGE_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const ALLOWED_DOC_MIME = {
  'application/pdf': '.pdf',
};
const ALLOWED_FILE_MIME = { ...ALLOWED_IMAGE_MIME, ...ALLOWED_DOC_MIME };

const MAX_FILE_SIZE_BYTES = Number(process.env.UPLOAD_MAX_FILE_BYTES) || 15 * 1024 * 1024; // 15 MB
const MAX_VOICE_SIZE_BYTES = Number(process.env.UPLOAD_MAX_VOICE_BYTES) || 20 * 1024 * 1024; // 20 MB, pre-transcode
const MAX_VOICE_DURATION_SECONDS = Number(process.env.UPLOAD_MAX_VOICE_SECONDS) || 300; // 5 min cap

/**
 * Ensure a per-conversation upload directory exists. Conversation IDs are
 * integers validated by the route (see routes/files.js) before this is
 * ever called, so there's no user-controlled string reaching the path.
 */
function conversationDir(conversationId, subdir = '') {
  const dir = path.join(UPLOAD_ROOT, String(conversationId), subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function randomStorageName(ext) {
  return `${crypto.randomUUID()}${ext}`;
}

// ---- Multer: file/photo/document uploads ----
const fileStorage = multer.diskStorage({
  destination(req, _file, cb) {
    try {
      cb(null, conversationDir(req.conversationId, 'files'));
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = ALLOWED_FILE_MIME[file.mimetype] || '';
    cb(null, randomStorageName(ext));
  },
});

const uploadFile = multer({
  storage: fileStorage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_FILE_MIME[file.mimetype]) {
      return cb(new Error('UNSUPPORTED_FILE_TYPE'));
    }
    cb(null, true);
  },
});

const voiceStorage = multer.diskStorage({
  destination(req, _file, cb) {
    try {
      cb(null, conversationDir(req.conversationId, 'voice-raw'));
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, _file, cb) {
    cb(null, randomStorageName('.raw'));
  },
});

const uploadVoice = multer({
  storage: voiceStorage,
  limits: { fileSize: MAX_VOICE_SIZE_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('audio/')) {
      return cb(new Error('UNSUPPORTED_FILE_TYPE'));
    }
    cb(null, true);
  },
});

async function verifyFileType(filePath, allowedMimeMap) {
  const { fileTypeFromFile } = await import('file-type'); // ESM-only package, CJS caller
  const detected = await fileTypeFromFile(filePath);
  if (!detected || !allowedMimeMap[detected.mime]) return null;
  return detected;
}

/** Streaming SHA-256 — never loads the whole file into memory (SR-10). */
function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function deleteFileSafely(filePath) {
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      system.error('Failed to remove rejected upload', { context: 'upload', error: err.message });
    }
  });
}

module.exports = {
  UPLOAD_ROOT,
  ALLOWED_IMAGE_MIME,
  ALLOWED_DOC_MIME,
  ALLOWED_FILE_MIME,
  MAX_FILE_SIZE_BYTES,
  MAX_VOICE_SIZE_BYTES,
  MAX_VOICE_DURATION_SECONDS,
  conversationDir,
  randomStorageName,
  uploadFile,
  uploadVoice,
  verifyFileType,
  computeSha256,
  deleteFileSafely,
};