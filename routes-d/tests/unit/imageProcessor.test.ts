import { PNG } from "pngjs";
import {
  stripJpegExif,
  detectMimeType,
  resizeRgba,
  decodePng,
  encodePng,
  processAvatar,
  AVATAR_SIZES,
  MAX_UPLOAD_BYTES,
} from "../../lib/imageProcessor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid PNG buffer (1×1 red pixel) via pngjs. */
function makePng(width = 1, height = 1, fill = [255, 0, 0, 255]): Buffer {
  const png = new PNG({ width, height, filterType: -1 });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = fill[0];
      png.data[idx + 1] = fill[1];
      png.data[idx + 2] = fill[2];
      png.data[idx + 3] = fill[3];
    }
  }
  return PNG.sync.write(png);
}

/**
 * Build a minimal JPEG-like buffer with a fake APP1 (EXIF) segment.
 * Structure: SOI  APP0(JFIF)  APP1(fake-EXIF)  SOS+data
 */
function makeJpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);

  // APP0 – minimal JFIF: marker + 2-byte length (16) + 5 "JFIF\0" + 9 bytes padding
  const app0Payload = Buffer.alloc(14, 0);
  app0Payload.write("JFIF\0", 0, "ascii");
  const app0Len = app0Payload.length + 2; // length field includes itself
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, app0Len >> 8, app0Len & 0xff]),
    app0Payload,
  ]);

  // APP1 – fake EXIF payload
  const exifPayload = Buffer.from("Exif\0\0FakeExifData", "ascii");
  const app1Len = exifPayload.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, app1Len >> 8, app1Len & 0xff]),
    exifPayload,
  ]);

  // SOF0 – minimal frame header: FF C0, length=17, precision=8, height=4, width=4, 3 components
  const sof0 = Buffer.from([
    0xff, 0xc0,
    0x00, 0x11, // length = 17
    0x08,       // precision
    0x00, 0x04, // height = 4
    0x00, 0x04, // width = 4
    0x03,       // 3 components
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]);

  // SOS – start of scan (we terminate immediately with EOI)
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const eoi = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([soi, app0, app1, sof0, sos, eoi]);
}

/** Build a JPEG with NO EXIF (only APP0). */
function makeJpegNoExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0Payload = Buffer.alloc(14, 0);
  app0Payload.write("JFIF\0", 0, "ascii");
  const app0Len = app0Payload.length + 2;
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, app0Len >> 8, app0Len & 0xff]),
    app0Payload,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sos, eoi]);
}

// ---------------------------------------------------------------------------
// detectMimeType
// ---------------------------------------------------------------------------

describe("detectMimeType", () => {
  it("detects PNG from magic bytes", () => {
    const buf = makePng();
    expect(detectMimeType(buf)).toBe("image/png");
  });

  it("detects JPEG from magic bytes", () => {
    const buf = makeJpegNoExif();
    expect(detectMimeType(buf)).toBe("image/jpeg");
  });

  it("throws for unsupported types (GIF magic bytes)", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    expect(() => detectMimeType(buf)).toThrow("Unsupported image type");
  });

  it("throws for random bytes", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(() => detectMimeType(buf)).toThrow("Unsupported image type");
  });
});

// ---------------------------------------------------------------------------
// stripJpegExif
// ---------------------------------------------------------------------------

describe("stripJpegExif", () => {
  it("removes APP1 (EXIF) segment from JPEG", () => {
    const input = makeJpegWithExif();
    const output = stripJpegExif(input);

    // APP1 marker 0xE1 should not appear in stripped output
    // (search for FF E1 pattern)
    let foundApp1 = false;
    for (let i = 0; i < output.length - 1; i++) {
      if (output[i] === 0xff && output[i + 1] === 0xe1) {
        foundApp1 = true;
        break;
      }
    }
    expect(foundApp1).toBe(false);
  });

  it("preserves APP0 (JFIF) segment", () => {
    const input = makeJpegWithExif();
    const output = stripJpegExif(input);

    // APP0 marker 0xE0 must still be present
    let foundApp0 = false;
    for (let i = 0; i < output.length - 1; i++) {
      if (output[i] === 0xff && output[i + 1] === 0xe0) {
        foundApp0 = true;
        break;
      }
    }
    expect(foundApp0).toBe(true);
  });

  it("preserves SOI marker", () => {
    const input = makeJpegWithExif();
    const output = stripJpegExif(input);
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);
  });

  it("is idempotent when there is no EXIF to strip", () => {
    const input = makeJpegNoExif();
    const output = stripJpegExif(input);
    // Output must still be a valid JPEG starting with SOI
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);
    // Should be smaller-or-equal in size (no overhead added)
    expect(output.length).toBeLessThanOrEqual(input.length);
  });

  it("throws for non-JPEG input", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    expect(() => stripJpegExif(buf)).toThrow("Not a valid JPEG");
  });
});

// ---------------------------------------------------------------------------
// resizeRgba
// ---------------------------------------------------------------------------

describe("resizeRgba", () => {
  it("scales a 4×4 RGBA buffer down to 2×2", () => {
    const src = Buffer.alloc(4 * 4 * 4, 0xff); // all white
    const dst = resizeRgba(src, 4, 4, 2, 2);
    expect(dst.length).toBe(2 * 2 * 4);
  });

  it("scales up correctly (1×1 → 4×4)", () => {
    const src = Buffer.alloc(1 * 1 * 4);
    src[0] = 100; src[1] = 150; src[2] = 200; src[3] = 255;
    const dst = resizeRgba(src, 1, 1, 4, 4);
    expect(dst.length).toBe(4 * 4 * 4);
    // All pixels should match the source
    for (let i = 0; i < 4 * 4; i++) {
      expect(dst[i * 4]).toBe(100);
      expect(dst[i * 4 + 1]).toBe(150);
      expect(dst[i * 4 + 2]).toBe(200);
      expect(dst[i * 4 + 3]).toBe(255);
    }
  });

  it("returns correct byte length for arbitrary dimensions", () => {
    const src = Buffer.alloc(64 * 64 * 4, 0xaa);
    const dst = resizeRgba(src, 64, 64, 32, 32);
    expect(dst.length).toBe(32 * 32 * 4);
  });
});

// ---------------------------------------------------------------------------
// decodePng / encodePng round-trip
// ---------------------------------------------------------------------------

describe("decodePng / encodePng round-trip", () => {
  it("decodes a valid PNG and returns correct dimensions", async () => {
    const pngBuf = makePng(8, 8);
    const { width, height } = await decodePng(pngBuf);
    expect(width).toBe(8);
    expect(height).toBe(8);
  });

  it("data length matches width × height × 4", async () => {
    const pngBuf = makePng(4, 4);
    const { width, height, data } = await decodePng(pngBuf);
    expect(data.length).toBe(width * height * 4);
  });

  it("rejects corrupted PNG data", async () => {
    const bad = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
    await expect(decodePng(bad)).rejects.toThrow();
  });

  it("encodes RGBA data back to a valid PNG", async () => {
    const pngBuf = makePng(4, 4, [10, 20, 30, 255]);
    const { width, height, data } = await decodePng(pngBuf);
    const encoded = encodePng(width, height, data);
    // Re-decode and verify first pixel
    const { data: data2 } = await decodePng(encoded);
    expect(data2[0]).toBe(10);
    expect(data2[1]).toBe(20);
    expect(data2[2]).toBe(30);
    expect(data2[3]).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// processAvatar (end-to-end)
// ---------------------------------------------------------------------------

describe("processAvatar", () => {
  it("produces variants at all canonical sizes from a PNG", async () => {
    const png = makePng(300, 300);
    const result = await processAvatar(png);

    expect(result.originalMimeType).toBe("image/png");
    expect(result.variants).toHaveLength(AVATAR_SIZES.length);

    for (const size of AVATAR_SIZES) {
      const variant = result.variants.find((v) => v.size === size);
      expect(variant).toBeDefined();
      expect(variant!.mimeType).toBe("image/png");
      expect(variant!.data.length).toBeGreaterThan(0);
    }
  });

  it("each PNG variant decodes to the correct dimensions", async () => {
    const png = makePng(200, 200);
    const result = await processAvatar(png);

    for (const variant of result.variants) {
      const { width, height } = await decodePng(variant.data);
      expect(width).toBe(variant.size);
      expect(height).toBe(variant.size);
    }
  });

  it("strips EXIF from JPEG and still produces correct PNG variants", async () => {
    const jpeg = makeJpegWithExif();
    const result = await processAvatar(jpeg);

    expect(result.originalMimeType).toBe("image/jpeg");
    expect(result.variants).toHaveLength(AVATAR_SIZES.length);
    for (const v of result.variants) {
      // Verify re-encoded as PNG (PNG magic bytes)
      expect(v.data[0]).toBe(0x89);
      expect(v.data[1]).toBe(0x50);
    }
  });

  it("throws UNSUPPORTED type error for GIF bytes", async () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
    await expect(processAvatar(gif)).rejects.toThrow("Unsupported image type");
  });

  it("throws size error when image exceeds MAX_UPLOAD_BYTES", async () => {
    const oversize = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    await expect(processAvatar(oversize)).rejects.toThrow("maximum allowed size");
  });

  it("accepts a 1×1 PNG (minimum valid image)", async () => {
    const tiny = makePng(1, 1);
    const result = await processAvatar(tiny);
    expect(result.variants).toHaveLength(AVATAR_SIZES.length);
  });
});
