const ffmpeg = require('fluent-ffmpeg');
const { MAX_VOICE_DURATION_SECONDS } = require('../middleware/upload');

/**
 * TranscoderAdapter — Ports & Adapters over fluent-ffmpeg.
 *
 * The only place in the codebase that knows the FFmpeg API. Callers depend on
 * "probe + transcode a voice recording" and get back { durationSeconds } or a
 * thrown Error — never touching ffmpeg directly. Swapping FFmpeg for a cloud
 * transcoding service later means changing only this class.
 *
 * The duration cap is injected (defaulting to the upload middleware's value)
 * for testability.
 */
class FfmpegTranscoder {
  constructor(maxDurationSeconds = MAX_VOICE_DURATION_SECONDS) {
    this.maxDurationSeconds = maxDurationSeconds;
  }

  probeDuration(inputPath) {
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

  transcodeToOpus(inputPath, outputPath) {
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
   * Validate + normalise a raw uploaded voice recording. Throws
   * Error('INVALID_AUDIO') if not decodable audio, Error('VOICE_TOO_LONG') if
   * over the duration cap. Returns { durationSeconds }; the caller checksums the
   * OUTPUT file and deletes the raw input.
   */
  async probeAndTranscode(inputPath, outputPath) {
    const durationSeconds = await this.probeDuration(inputPath);
    if (durationSeconds > this.maxDurationSeconds) {
      throw new Error('VOICE_TOO_LONG');
    }
    await this.transcodeToOpus(inputPath, outputPath);
    return { durationSeconds: Math.round(durationSeconds) };
  }
}

module.exports = { FfmpegTranscoder };
