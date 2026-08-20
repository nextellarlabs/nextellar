/**
 * Integration tests for account avatar upload/fetch/delete pipeline.
 *
 * These tests exercise the full route stack end-to-end: multipart parsing,
 * image processing, storage, and retrieval.
 */

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { PNG } from "pngjs";
import avatarRouter, {
  __resetAvatarStore,
} from "../../routes/account.avatar.js";
import {
  AVATAR_SIZES,
  decodePng,
} from "../../lib/imageProcessor.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(avatarRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makePng(width: number, height: number, color = [200, 100, 50, 255]): Buffer {
  const png = new PNG({ width, height, filterType: -1 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color[0];
    png.data[i + 1] = color[1];
    png.data[i + 2] = color[2];
    png.data[i + 3] = color[3];
  }
  return PNG.sync.write(png);
}

function makeJpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0Payload = Buffer.alloc(14, 0);
  app0Payload.write("JFIF\0", 0, "ascii");
  const app0Len = app0Payload.length + 2;
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, app0Len >> 8, app0Len & 0xff]),
    app0Payload,
  ]);
  const exifPayload = Buffer.from("Exif\0\0SensitiveLocationData!!", "ascii");
  const app1Len = exifPayload.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, app1Len >> 8, app1Len & 0xff]),
    exifPayload,
  ]);
  const sof0 = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0x10, 0x00, 0x10, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, app1, sof0, sos, eoi]);
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("Avatar integration: upload → fetch cycle", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAvatarStore();
  });

  it("full happy-path: upload PNG then fetch each canonical size", async () => {
    const userId = "integ-user-1";
    const original = makePng(300, 300);

    // Upload
    const uploadRes = await request(app)
      .post("/account/avatar")
      .set("x-user-id", userId)
      .attach("avatar", original, { filename: "photo.png", contentType: "image/png" });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.sizes).toEqual([...AVATAR_SIZES]);

    // Fetch each size and verify PNG dimensions
    for (const size of AVATAR_SIZES) {
      const fetchRes = await request(app)
        .get(`/account/avatar?size=${size}`)
        .set("x-user-id", userId)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(fetchRes.status).toBe(200);
      expect(fetchRes.headers["content-type"]).toMatch(/image\/png/);

      const decoded = await decodePng(fetchRes.body as Buffer);
      expect(decoded.width).toBe(size);
      expect(decoded.height).toBe(size);
    }
  });

  it("full happy-path: upload JPEG with EXIF then verify EXIF stripped in stored PNG", async () => {
    const userId = "integ-user-2";
    const jpeg = makeJpegWithExif();

    const uploadRes = await request(app)
      .post("/account/avatar")
      .set("x-user-id", userId)
      .attach("avatar", jpeg, { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(uploadRes.status).toBe(201);

    // Fetch stored data and verify no APP1 EXIF marker in returned PNG
    const fetchRes = await request(app)
      .get("/account/avatar?size=128")
      .set("x-user-id", userId)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(fetchRes.status).toBe(200);
    const pngBuf = fetchRes.body as Buffer;

    // Stored as PNG – verify PNG magic bytes (not JPEG)
    expect(pngBuf[0]).toBe(0x89); // PNG
    expect(pngBuf[1]).toBe(0x50);

    // No JPEG APP1 marker (0xFF 0xE1) should appear in the PNG
    let foundApp1 = false;
    for (let i = 0; i < pngBuf.length - 1; i++) {
      if (pngBuf[i] === 0xff && pngBuf[i + 1] === 0xe1) { foundApp1 = true; break; }
    }
    expect(foundApp1).toBe(false);
  });

  it("re-upload replaces all variants atomically", async () => {
    const userId = "integ-user-3";
    const first = makePng(200, 200, [255, 0, 0, 255]);
    const second = makePng(200, 200, [0, 0, 255, 255]);

    await request(app)
      .post("/account/avatar")
      .set("x-user-id", userId)
      .attach("avatar", first, { filename: "first.png", contentType: "image/png" });

    const uploadRes2 = await request(app)
      .post("/account/avatar")
      .set("x-user-id", userId)
      .attach("avatar", second, { filename: "second.png", contentType: "image/png" });

    expect(uploadRes2.status).toBe(201);

    // Both uploads should result in all sizes being present
    for (const size of AVATAR_SIZES) {
      const res = await request(app)
        .get(`/account/avatar?size=${size}`)
        .set("x-user-id", userId);
      expect(res.status).toBe(200);
    }
  });

  it("upload then delete then GET returns 404", async () => {
    const userId = "integ-user-4";
    const png = makePng(64, 64);

    await request(app)
      .post("/account/avatar")
      .set("x-user-id", userId)
      .attach("avatar", png, { filename: "a.png", contentType: "image/png" });

    const delRes = await request(app)
      .delete("/account/avatar")
      .set("x-user-id", userId);

    expect(delRes.status).toBe(200);

    const getRes = await request(app)
      .get("/account/avatar")
      .set("x-user-id", userId);

    expect(getRes.status).toBe(404);
  });

  it("two users have independent avatar stores", async () => {
    const userA = "integ-user-A";
    const userB = "integ-user-B";

    await request(app)
      .post("/account/avatar")
      .set("x-user-id", userA)
      .attach("avatar", makePng(50, 50), { filename: "a.png", contentType: "image/png" });

    // UserB has no avatar yet
    const resB = await request(app)
      .get("/account/avatar")
      .set("x-user-id", userB);

    expect(resB.status).toBe(404);

    // UserA still has avatar
    const resA = await request(app)
      .get("/account/avatar")
      .set("x-user-id", userA);

    expect(resA.status).toBe(200);
  });
});
