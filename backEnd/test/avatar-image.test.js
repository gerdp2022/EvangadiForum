import "../test-support/test-env.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectImageType } from "../src/api/profile/service/profile.service.js";

// The first bytes of each real file type, padded to 16 bytes.
const bytes = (...start) => Buffer.from([...start, ...Array(16).fill(0)]);
const ascii = (text) => Buffer.from(text.padEnd(16, "\0"), "ascii");

describe("detectImageType (only real images become avatars)", () => {
  test("should detect JPG, PNG and WebP images from their content, not their file name", () => {
    assert.equal(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
    assert.equal(
      detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
      "image/png",
    );
    assert.equal(detectImageType(ascii("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  });

  test("should reject an HTML page that was renamed to .png", () => {
    assert.equal(detectImageType(ascii("<html><script>alert(1)</script>")), null);
  });

  test("should reject PDFs, GIFs, empty buffers and missing input", () => {
    assert.equal(detectImageType(ascii("%PDF-1.7 document")), null);
    assert.equal(detectImageType(ascii("GIF89a animation")), null);
    assert.equal(detectImageType(Buffer.alloc(0)), null);
    assert.equal(detectImageType(undefined), null);
  });
});
