import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidImage, isValidAudio } from "./fileSignature.js";

describe("isValidImage (magic-byte upload validation)", () => {
  test("accepts real JPEG/PNG/GIF/WEBP signatures", () => {
    assert.equal(isValidImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(isValidImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
    assert.equal(isValidImage(Buffer.from("GIF89a")), true);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    assert.equal(isValidImage(webp), true);
  });

  test("rejects a file with a .png extension/mimeType claim but non-image bytes", () => {
    // Simulates an attacker uploading an HTML/JS payload renamed to look like an image.
    const fakeImage = Buffer.from("<script>alert(document.cookie)</script>");
    assert.equal(isValidImage(fakeImage), false);
  });

  test("rejects an empty buffer", () => {
    assert.equal(isValidImage(Buffer.alloc(0)), false);
  });

  test("rejects a polyglot-style buffer that merely contains image bytes later, not at the start", () => {
    const notAtStart = Buffer.concat([Buffer.from("junk-prefix"), Buffer.from([0xff, 0xd8, 0xff])]);
    assert.equal(isValidImage(notAtStart), false);
  });
});

describe("isValidAudio (magic-byte upload validation)", () => {
  test("accepts real WebM/MP4/MP3/WAV/OGG signatures", () => {
    assert.equal(isValidAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), true); // WebM
    assert.equal(
      isValidAudio(Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from("ftyp")])),
      true
    ); // MP4
    assert.equal(isValidAudio(Buffer.from("ID3")), true); // MP3 w/ ID3 tag
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE")]);
    assert.equal(isValidAudio(wav), true);
    assert.equal(isValidAudio(Buffer.from("OggS")), true);
  });

  test("rejects non-audio bytes even if a caller claims an audio mimeType", () => {
    const fakeAudio = Buffer.from("this is just plain text, not an audio file");
    assert.equal(isValidAudio(fakeAudio), false);
  });

  test("rejects a truncated/malformed buffer shorter than any known signature", () => {
    assert.equal(isValidAudio(Buffer.from([0xff])), false);
  });
});
