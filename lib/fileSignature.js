/**
 * Minimal magic-byte (file signature) checks for the two upload types this
 * app accepts. Client-supplied mimeType strings are never trustworthy on
 * their own - this verifies the actual bytes match a claimed image/audio
 * format before the upload is stored.
 */

function bytesStartWith(buffer, signature, offset = 0) {
  if (buffer.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) return false;
  }
  return true;
}

const IMAGE_SIGNATURES = [
  { mimeType: "image/jpeg", check: (buf) => bytesStartWith(buf, [0xff, 0xd8, 0xff]) },
  { mimeType: "image/png", check: (buf) => bytesStartWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: "image/gif", check: (buf) => bytesStartWith(buf, [0x47, 0x49, 0x46, 0x38]) }, // GIF8
  {
    mimeType: "image/webp",
    check: (buf) => bytesStartWith(buf, [0x52, 0x49, 0x46, 0x46]) && bytesStartWith(buf, [0x57, 0x45, 0x42, 0x50], 8), // RIFF....WEBP
  },
];

/**
 * True if the buffer's actual bytes match a known image format. Doesn't
 * check that it matches the specific claimed mimeType - callers that need
 * that should compare against detectImageMimeType(buffer) themselves.
 */
export function isValidImage(buffer) {
  return IMAGE_SIGNATURES.some(({ check }) => check(buffer));
}

const AUDIO_SIGNATURES = [
  // WebM/Matroska container (what MediaRecorder produces in Chrome/Firefox)
  { check: (buf) => bytesStartWith(buf, [0x1a, 0x45, 0xdf, 0xa3]) },
  // MP4/M4A container (Safari's MediaRecorder output; ISO base media file format,
  // signature is at offset 4, not the start of the buffer)
  { check: (buf) => bytesStartWith(buf, [0x66, 0x74, 0x79, 0x70], 4) }, // "ftyp"
  // Plain MP3 (either an ID3 tag, or a raw frame sync header)
  { check: (buf) => bytesStartWith(buf, [0x49, 0x44, 0x33]) }, // "ID3"
  { check: (buf) => buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 },
  // WAV (RIFF....WAVE)
  { check: (buf) => bytesStartWith(buf, [0x52, 0x49, 0x46, 0x46]) && bytesStartWith(buf, [0x57, 0x41, 0x56, 0x45], 8) },
  // Ogg container (Opus/Vorbis)
  { check: (buf) => bytesStartWith(buf, [0x4f, 0x67, 0x67, 0x53]) }, // "OggS"
];

export function isValidAudio(buffer) {
  return AUDIO_SIGNATURES.some(({ check }) => check(buffer));
}
