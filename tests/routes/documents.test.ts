import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import { detectMimeType } from "../../backend/routes/documents.js";

describe("detectMimeType", () => {
  it("detects PDF from magic bytes", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(detectMimeType(pdfBuffer)).toBe("application/pdf");
  });

  it("detects PNG from magic bytes", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(detectMimeType(pngBuffer)).toBe("image/png");
  });

  it("detects JPEG from magic bytes", () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectMimeType(jpegBuffer)).toBe("image/jpeg");
  });

  it("detects GIF from magic bytes", () => {
    const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectMimeType(gifBuffer)).toBe("image/gif");
  });

  it("returns null for an HTML file disguised with a .pdf extension", () => {
    const htmlBuffer = Buffer.from("<html><body>evil</body></html>");
    expect(detectMimeType(htmlBuffer)).toBeNull();
  });

  it("returns null for a JavaScript file", () => {
    const jsBuffer = Buffer.from("console.log('xss')");
    expect(detectMimeType(jsBuffer)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for an ELF executable", () => {
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]);
    expect(detectMimeType(elfBuffer)).toBeNull();
  });
});

import documentsRouter from "../../backend/routes/documents.js";

function buildApp() {
  const app = express();
  app.use(express.raw({ type: "*/*", limit: "10mb" }));
  app.use(documentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /documents/upload", () => {
  const app = buildApp();

  it("returns 200 for a valid PDF upload", async () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);

    const res = await request(app)
      .post("/documents/upload")
      .set("Content-Type", "application/octet-stream")
      .send(pdfBuffer);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mimeType).toBe("application/pdf");
  });

  it("returns 415 for a disguised HTML file", async () => {
    const htmlBuffer = Buffer.from("<html><script>alert('xss')</script></html>");

    const res = await request(app)
      .post("/documents/upload")
      .set("Content-Type", "application/octet-stream")
      .send(htmlBuffer);

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Unsupported file type");
  });

  it("returns 200 for a valid PNG upload", async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);

    const res = await request(app)
      .post("/documents/upload")
      .set("Content-Type", "application/octet-stream")
      .send(pngBuffer);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mimeType).toBe("image/png");
  });

  it("returns 400 when no file data is sent", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
