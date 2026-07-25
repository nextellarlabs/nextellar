import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import router, {
  __getSubmittedForms,
  __resetSubmittedForms,
} from "../routes/lancepay.tax.w9.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/tax-forms/w9", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSubmittedForms();
  });

  it("accepts a valid W-9 submission and encrypts sensitive fields at rest", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w9")
      .set("x-caller-id", "con-1")
      .send({
        contractorId: "con-1",
        legalName: "Acme LLC",
        tin: "123456789",
        signatureName: "Jane Doe",
        signatureTimestamp: "2026-07-25T12:00:00Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractorId).toBe("con-1");
    expect(res.body.data.keyId).toBe("lancepay-w9-v1");

    const forms = __getSubmittedForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].encryptedFields.tin).toContain("lancepay-w9-v1");
    expect(forms[0].encryptedFields.legalName).toContain("lancepay-w9-v1");
  });

  it("rejects submissions with an invalid TIN", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w9")
      .set("x-caller-id", "con-1")
      .send({
        contractorId: "con-1",
        legalName: "Acme LLC",
        tin: "bad-tin",
        signatureName: "Jane Doe",
        signatureTimestamp: "2026-07-25T12:00:00Z",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TIN");
  });

  it("rejects submissions from an unauthorized contractor", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w9")
      .set("x-caller-id", "con-2")
      .send({
        contractorId: "con-1",
        legalName: "Acme LLC",
        tin: "123456789",
        signatureName: "Jane Doe",
        signatureTimestamp: "2026-07-25T12:00:00Z",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
