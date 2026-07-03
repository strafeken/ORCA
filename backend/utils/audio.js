const ffmpeg = require('fluent-ffmpeg');
const { MAX_VOICE_DURATION_SECONDS } = require('../middleware/upload');

/**
 * audio.js — FFmpeg-backed voice message processing.
 *
 * Adapter pattern: this module is the only place in the codebase that knows
 * fluent-ffmpeg's API. routes/files.js calls `probeAndTranscode(...)` and
 * gets back a plain { durationSeconds } result or a thrown Error — it never
 * touches ffmpeg directly. If ORCA later swaps FFmpeg for a cloud transcoding
 * service, only this file changes.
 */

function probeDuration(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(new Error('INVALID_AUDIO'));
      const duration = data?.format?.duration;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        return reject(new Error('INVALID_AUDIO'));
      }
      resolve(duration);
    });
  });
}

function transcodeToOpus(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo() // strip any embedded video/image track — audio only
      .audioCodec('libopus')
      .audioBitrate('48k')
      .format('webm')
      .on('error', () => reject(new Error('INVALID_AUDIO')))
      .on('end', () => resolve())
      .save(outputPath);
  });
}

/**
 * probeAndTranscode — validate + normalise a raw uploaded voice recording.
 * Throws Error('INVALID_AUDIO') if the file isn't decodable audio, and
 * Error('VOICE_TOO_LONG') if it exceeds the configured duration cap
 * (storage-quota-exhaustion hardening — see D1 risk register).
 *
 * Returns { durationSeconds } on success; the caller is responsible for
 * checksumming the OUTPUT file (the transcoded one — that's what's actually
 * stored and served) and deleting the raw input afterwards.
 */
async function probeAndTranscode(inputPath, outputPath) {
  const durationSeconds = await probeDuration(inputPath);
  if (durationSeconds > MAX_VOICE_DURATION_SECONDS) {
    throw new Error('VOICE_TOO_LONG');
  }
  await transcodeToOpus(inputPath, outputPath);
  return { durationSeconds: Math.round(durationSeconds) };
}

module.exports = { probeAndTranscode };