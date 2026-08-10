import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { PNG } from "pngjs";
import avatarRouter, {
  __resetAvatarStore,
  __seedAvatar,
  __getAvatarStore,
} from "../routes/account.avatar.js";
import { AVATAR_SIZES } from "../lib/imageProcessor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(avatarRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

/** Build a valid in-memory PNG buffer at the given dimensions. */
function makePng(width = 64, height = 64): Buffer {
  const png = new PNG({ width, height, filterType: -1 });
  png.data.fill(0xaa);
  // Set alpha channel to 255
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 0xff;
  return PNG.sync.write(png);
}

/**
 * Build a minimal valid JPEG with a fake APP1 EXIF segment.
 * This mirrors the helper in the unit tests.
 */
function makeJpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0Payload = Buffer.alloc(14, 0);
  app0Payload.write("JFIF\0", 0, "ascii");
  const app0Len = app0Payload.length + 2;
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, app0Len >> 8, app0Len & 0xff]),
    app0Payload,
  ]);
  const exifPayload = Buffer.from("Exif\0\0FakeExifData", "ascii");
  const app1Len = exifPayload.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, app1Len >> 8, app1Len & 0xff]),
    exifPayload,
  ]);
  const sof0 = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0x04, 0x00, 0x04, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, app1, sof0, sos, eoi]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /account/avatar", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAvatarStore();
  });

  it("returns 201 and lists all canonical sizes after a valid PNG upload", async () => {
    const png = makePng(200, 200);

    const res = await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-1")
      .attach("avatar", png, { filename: "avatar.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe("user-1");
    expect(res.body.data.sizes).toEqual([...AVATAR_SIZES]);
    expect(res.body.data.uploadedAt).toBeDefined();
  });

  it("stores all size variants in the avatar store", async () => {
    const png = makePng(100, 100);

    await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-2")
      .attach("avatar", png, { filename: "avatar.png", contentType: "image/png" });

    const store = __getAvatarStore();
    const entry = store.get("user-2");
    expect(entry).toBeDefined();
    expect(entry!.variants.size).toBe(AVATAR_SIZES.length);

    for (const size of AVATAR_SIZES) {
      expect(entry!.variants.has(size)).toBe(true);
      expect(entry!.variants.get(size)!.data.length).toBeGreaterThan(0);
    }
  });

  it("accepts a JPEG upload and produces PNG variants", async () => {
    const jpeg = makeJpegWithExif();

    const res = await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-3")
      .attach("avatar", jpeg, { filename: "avatar.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.data.sizes).toEqual([...AVATAR_SIZES]);

    // Verify stored data is PNG (magic bytes)
    const store = __getAvatarStore();
    const variant = store.get("user-3")!.variants.get(128)!;
    expect(variant.data[0]).toBe(0x89);
    expect(variant.data[1]).toBe(0x50);
  });

  it("replaces an existing avatar on a second upload", async () => {
    const png1 = makePng(80, 80);
    const png2 = makePng(90, 90);

    await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-4")
      .attach("avatar", png1, { filename: "a1.png", contentType: "image/png" });

    const res2 = await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-4")
      .attach("avatar", png2, { filename: "a2.png", contentType: "image/png" });

    expect(res2.status).toBe(201);
    const store = __getAvatarStore();
    expect(store.get("user-4")).toBeDefined();
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const png = makePng();
    const res = await request(app)
      .post("/account/avatar")
      .attach("avatar", png, { filename: "avatar.png", contentType: "image/png" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when no file is attached", async () => {
    const res = await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-5")
      .set("Content-Type", "multipart/form-data");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILE");
  });

  it("returns 415 for unsupported file type (GIF)", async () => {
    // GIF89a magic bytes followed by minimal content
    const gif = Buffer.concat([
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      Buffer.alloc(20, 0),
    ]);

    const res = await request(app)
      .post("/account/avatar")
      .set("x-user-id", "user-6")
      .attach("avatar", gif, { filename: "avatar.gif", contentType: "image/gif" });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_TYPE");
  });
});

// ---------------------------------------------------------------------------
// GET /account/avatar
// ---------------------------------------------------------------------------

describe("GET /account/avatar", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAvatarStore();
  });

  it("returns 200 with PNG binary at default size 128", async () => {
    // Seed with real PNG data for all sizes
    const variants = AVATAR_SIZES.map((size) => ({
      size,
      data: makePng(size, size),
    }));
    __seedAvatar("user-1", variants);

    const res = await request(app)
      .get("/account/avatar")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.body).toBeDefined();
  });

  it("returns the correct variant for each canonical size", async () => {
    const variants = AVATAR_SIZES.map((size) => ({
      size,
      data: makePng(size, size),
    }));
    __seedAvatar("user-1", variants);

    for (const size of AVATAR_SIZES) {
      const res = await request(app)
        .get(`/account/avatar?size=${size}`)
        .set("x-user-id", "user-1")
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      // PNG magic bytes
      const buf = res.body as Buffer;
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
    }
  });

  it("returns 401 when x-user-id is missing", async () => {
    const res = await request(app).get("/account/avatar");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when no avatar exists for the user", async () => {
    const res = await request(app)
      .get("/account/avatar")
      .set("x-user-id", "no-avatar-user");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("AVATAR_NOT_FOUND");
  });

  it("returns 400 for invalid size parameter", async () => {
    const variants = AVATAR_SIZES.map((size) => ({ size, data: makePng(size, size) }));
    __seedAvatar("user-1", variants);

    const res = await request(app)
      .get("/account/avatar?size=999")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIZE");
  });

  it("returns 400 for non-numeric size parameter", async () => {
    const variants = AVATAR_SIZES.map((size) => ({ size, data: makePng(size, size) }));
    __seedAvatar("user-1", variants);

    const res = await request(app)
      .get("/account/avatar?size=large")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIZE");
  });
});

// ---------------------------------------------------------------------------
// DELETE /account/avatar
// ---------------------------------------------------------------------------

describe("DELETE /account/avatar", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAvatarStore();
  });

  it("returns 200 and removes the avatar", async () => {
    const variants = AVATAR_SIZES.map((size) => ({ size, data: makePng(size, size) }));
    __seedAvatar("user-1", variants);

    const res = await request(app)
      .delete("/account/avatar")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Subsequent GET should 404
    const getRes = await request(app)
      .get("/account/avatar")
      .set("x-user-id", "user-1");
    expect(getRes.status).toBe(404);
  });

  it("returns 401 when x-user-id is missing", async () => {
    const res = await request(app).delete("/account/avatar");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when user has no avatar", async () => {
    const res = await request(app)
      .delete("/account/avatar")
      .set("x-user-id", "ghost-user");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("AVATAR_NOT_FOUND");
  });
});
