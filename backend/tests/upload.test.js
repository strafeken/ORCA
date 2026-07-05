const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
}));

const {
  ALLOWED_IMAGE_MIME,
  ALLOWED_DOC_MIME,
  ALLOWED_FILE_MIME,
  MAX_FILE_SIZE_BYTES,
  MAX_VOICE_SIZE_BYTES,
  MAX_VOICE_DURATION_SECONDS,
  randomStorageName,
  computeSha256,
} = require('../middleware/upload');

/**
 * Tests for middleware/upload.js — the file-upload security controls.
 *
 * Maps to FR-08 (file upload) and SR-14 (MIME type + size limits), and the
 * integrity control SR-10 (checksum on upload). Verifies the allowlists only
 * permit safe types, that size caps are configured, that stored names are
 * randomised (so a malicious original filename can't drive the path — T-27),
 * and that the SHA-256 checksum is correct.
 */
describe('upload allowlists (SR-14 MIME validation)', () => {
  test('image allowlist only contains safe image types', () => {
    expect(Object.keys(ALLOWED_IMAGE_MIME).sort()).toEqual(
      ['image/gif', 'image/jpeg', 'image/png', 'image/webp']
    );
  });

  test('document allowlist only permits PDF', () => {
    expect(Object.keys(ALLOWED_DOC_MIME)).toEqual(['application/pdf']);
  });

  test('combined file allowlist maps each MIME to a safe extension', () => {
    expect(ALLOWED_FILE_MIME['image/jpeg']).toBe('.jpg');
    expect(ALLOWED_FILE_MIME['application/pdf']).toBe('.pdf');
  });

  test('dangerous types are NOT in the allowlist', () => {
    // Executables / scripts / SVG (XSS vector) must be rejected.
    expect(ALLOWED_FILE_MIME['application/x-msdownload']).toBeUndefined();
    expect(ALLOWED_FILE_MIME['text/html']).toBeUndefined();
    expect(ALLOWED_FILE_MIME['image/svg+xml']).toBeUndefined();
    expect(ALLOWED_FILE_MIME['application/javascript']).toBeUndefined();
  });
});

describe('upload size limits (SR-14 size caps)', () => {
  test('file size cap is a positive number', () => {
    expect(MAX_FILE_SIZE_BYTES).toBeGreaterThan(0);
  });

  test('voice size cap is a positive number', () => {
    expect(MAX_VOICE_SIZE_BYTES).toBeGreaterThan(0);
  });

  test('voice duration is capped (DoS prevention)', () => {
    expect(MAX_VOICE_DURATION_SECONDS).toBeGreaterThan(0);
    expect(MAX_VOICE_DURATION_SECONDS).toBeLessThanOrEqual(600); // sane upper bound
  });
});

describe('randomStorageName (T-27: no user-controlled path)', () => {
  test('generates a random name with the given extension', () => {
    const name = randomStorageName('.jpg');
    expect(name.endsWith('.jpg')).toBe(true);
    // UUID v4 style prefix — no original filename, no path separators.
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });

  test('two calls produce different names', () => {
    expect(randomStorageName('.png')).not.toBe(randomStorageName('.png'));
  });
});

describe('computeSha256 (SR-10 integrity checksum)', () => {
  let tmpFile;
  beforeAll(() => {
    tmpFile = path.join(os.tmpdir(), `orca-upload-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello world');
  });
  afterAll(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  test('produces the correct SHA-256 for known content', async () => {
    // Known SHA-256 of "hello world".
    const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    await expect(computeSha256(tmpFile)).resolves.toBe(expected);
  });

  test('rejects (does not hang) on a missing file', async () => {
    await expect(computeSha256('/no/such/file/here')).rejects.toBeTruthy();
  });
});
