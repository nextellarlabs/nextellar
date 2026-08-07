import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import kycUploadRouter, { __getMaxFileSize } from "../routes/kyc.upload.js";
import { __resetUploads } from "../lib/uploadHelper.js";

function buildApp() {
  const app = express();
  app.use(kycUploadRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /kyc/upload", () => {
  const app = buildApp();
  const authHeader = { "x-user-id": "user-001" };

  const validPdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x01, 0x02, 0x03]);

  beforeEach(() => {
    __resetUploads();
  });

  it("accepts a valid PDF file and returns upload metadata", async () => {
    const res = await request(app)
      .post("/kyc/upload")
      .set(authHeader)
      .attach("file", validPdfBytes, "document.pdf");

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.fileName).toBe("document.pdf");
    expect(res.body.data.mimeType).toBe("application/pdf");
    expect(res.body.data.size).toBe(validPdfBytes.length);
    expect(res.body.data).toHaveProperty("presignedUrl");
    expect(res.body.data).toHaveProperty("uploadedAt");
    expect(res.body.data.presignedUrl).toContain("storage.nextellar.dev");
  });

  it("rejects an oversized file", async () => {
    const oversized = Buffer.alloc(__getMaxFileSize() + 1, 0x00);

    const res = await request(app)
      .post("/kyc/upload")
      .set(authHeader)
      .attach("file", oversized, {
        filename: "large.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an unsupported file type via MIME check", async () => {
    const res = await request(app)
      .post("/kyc/upload")
      .set(authHeader)
      .attach("file", Buffer.from("binary-data"), "malware.exe");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects requests without authentication", async () => {
    const res = await request(app)
      .post("/kyc/upload")
      .attach("file", validPdfBytes, "document.pdf");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests without a file", async () => {
    const res = await request(app)
      .post("/kyc/upload")
      .set(authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILE");
  });

  it("rejects a file with mismatched content (invalid magic bytes)", async () => {
    const res = await request(app)
      .post("/kyc/upload")
      .set(authHeader)
      .attach("file", Buffer.from("fake-png-content"), {
        filename: "image.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("INVALID_FILE_CONTENT");
  });

  it("stores the file record and returns the presigned URL", async () => {
    const res = await request(app)
      .post("/kyc/upload")
      .set(authHeader)
      .attach("file", validPdfBytes, "document.pdf");

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.presignedUrl).toMatch(
      /^https:\/\/storage\.nextellar\.dev\/kyc\//,
    );
  });

  it("handles concurrent uploads with unique IDs", async () => {
    const [r1, r2] = await Promise.all([
      request(app).post("/kyc/upload").set(authHeader).attach("file", validPdfBytes, "doc1.pdf"),
      request(app).post("/kyc/upload").set(authHeader).attach("file", validPdfBytes, "doc2.pdf"),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.data.id).not.toBe(r2.body.data.id);
    expect(r1.body.data.fileName).toBe("doc1.pdf");
    expect(r2.body.data.fileName).toBe("doc2.pdf");
  });
});
