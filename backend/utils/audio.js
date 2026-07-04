const { FfmpegTranscoder } = require('../adapters/TranscoderAdapter');

/**
 * audio.js — voice message processing.
 *
 * The FFmpeg work now lives in the FfmpegTranscoder adapter
 * (adapters/TranscoderAdapter.js). This module keeps the stable
 * `probeAndTranscode` function that routes/files.js already imports.
 */
const transcoder = new FfmpegTranscoder();

async function probeAndTranscode(inputPath, outputPath) {
  return transcoder.probeAndTranscode(inputPath, outputPath);
}

module.exports = { probeAndTranscode };
