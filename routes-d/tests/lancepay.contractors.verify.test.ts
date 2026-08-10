import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedVerification,
  __resetVerifications,
  __getVerifications,
} from "../routes/lancepay.contractors.verify.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/contractors/:id/verify", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetVerifications();
  });

  it("creates a pending verification with valid documents", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc1.pdf"],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.contractorId).toBe("con-1");
    expect(res.body.data.verdict).toBe("pending");
    expect(res.body.data.documentUrls.length).toBe(1);
    expect(res.body.data.auditTrail.length).toBe(1);
    expect(res.body.data.auditTrail[0].action).toBe("submitted");
  });

  it("creates an approved verification with verdict", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc1.pdf"],
        verdict: "approved",
        verifiedBy: "verifier-1",
        verifierNotes: "All documents verified",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.verdict).toBe("approved");
    expect(res.body.data.verifiedBy).toBe("verifier-1");
    expect(res.body.data.verifierNotes).toBe("All documents verified");
    expect(res.body.data.auditTrail.length).toBe(2);
    expect(res.body.data.auditTrail[1].action).toBe("approved");
  });

  it("creates a rejected verification with verdict", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc1.pdf"],
        verdict: "rejected",
        verifiedBy: "verifier-2",
        verifierNotes: "Document quality insufficient",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.verdict).toBe("rejected");
    expect(res.body.data.verifiedBy).toBe("verifier-2");
    expect(res.body.data.auditTrail.length).toBe(2);
    expect(res.body.data.auditTrail[1].action).toBe("rejected");
  });

  it("accepts multiple document URLs", async () => {
    const docs = [
      "https://example.com/passport.pdf",
      "https://example.com/address.pdf",
      "https://example.com/business_license.pdf",
    ];

    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({ documentUrls: docs });

    expect(res.status).toBe(201);
    expect(res.body.data.documentUrls.length).toBe(3);
    expect(res.body.data.documentUrls).toEqual(docs);
  });

  it("returns 400 for missing documentUrls", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DOCUMENTS");
  });

  it("returns 400 for empty documentUrls array", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({ documentUrls: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DOCUMENTS");
  });

  it("returns 400 for non-array documentUrls", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({ documentUrls: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DOCUMENTS");
  });

  it("returns 400 for empty document URL in array", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({ documentUrls: ["https://example.com/doc.pdf", ""] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DOCUMENT_URL");
  });

  it("returns 400 for invalid verdict", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc.pdf"],
        verdict: "maybe",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_VERDICT");
  });

  it("returns 400 for empty contractor id", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/  /verify")
      .set("x-workspace-id", "ws-1")
      .send({ documentUrls: ["https://example.com/doc.pdf"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACTOR_ID");
  });

  it("accepts optional verifierNotes", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc.pdf"],
        verdict: "approved",
        verifierNotes: "Comprehensive verification completed",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.verifierNotes).toBe("Comprehensive verification completed");
  });

  it("defaults to system verifier when not provided", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc.pdf"],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.auditTrail[0].performedBy).toBe("system");
  });

  it("does not set verifiedBy for pending verdicts", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/verify")
      .set("x-workspace-id", "ws-1")
      .send({
        documentUrls: ["https://example.com/doc.pdf"],
        verdict: "pending",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.verifiedBy).toBeUndefined();
    expect(res.body.data.verifiedAt).toBeUndefined();
  });
});
