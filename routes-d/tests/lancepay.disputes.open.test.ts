import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __resetPayouts,
  __resetDisputes,
  __getPayout,
} from "../routes/lancepay.disputes.open.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_BODY = {
  payoutId: "pay-1",
  workspaceId: "ws-1",
  reasonCode: "unauthorized_transaction",
  evidenceAttachments: ["https://example.com/evidence1.png", "https://example.com/evidence2.pdf"],
};

describe("POST /lancepay/disputes", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
    __resetDisputes();
  });

  it("opens a dispute successfully", async () => {
    __seedPayout({ id: "pay-1", workspaceId: "ws-1", status: "completed" });

    const res = await request(app).post("/lancepay/disputes").send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payoutId).toBe("pay-1");
    expect(res.body.data.reasonCode).toBe("unauthorized_transaction");
    expect(res.body.data.evidenceAttachments).toHaveLength(2);
    expect(res.body.data.status).toBe("open");

    const payout = __getPayout("pay-1");
    expect(payout?.frozenForDispute).toBe(true);
  });

  it("returns duplicate response for payout with existing open dispute", async () => {
    __seedPayout({ id: "pay-2", workspaceId: "ws-1", status: "completed" });

    // Open first dispute
    await request(app).post("/lancepay/disputes").send({ ...VALID_BODY, payoutId: "pay-2" });

    // Try to open duplicate dispute
    const res = await request(app).post("/lancepay/disputes").send({ ...VALID_BODY, payoutId: "pay-2" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_DISPUTE");
  });

  it("returns 400 for invalid reason code", async () => {
    __seedPayout({ id: "pay-3", workspaceId: "ws-1", status: "completed" });

    const res = await request(app)
      .post("/lancepay/disputes")
      .send({ ...VALID_BODY, payoutId: "pay-3", reasonCode: "invalid_reason" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REASON_CODE");
  });

  it("returns 404 for non-existent payout", async () => {
    const res = await request(app).post("/lancepay/disputes").send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when payoutId is missing", async () => {
    const { payoutId: _p, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/disputes").send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAYOUT_ID");
  });

  it("returns 400 when workspaceId is missing", async () => {
    const { workspaceId: _w, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/disputes").send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WORKSPACE_ID");
  });

  it("returns 400 when reasonCode is missing", async () => {
    const { reasonCode: _r, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/disputes").send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REASON_CODE");
  });

  it("returns 400 when evidenceAttachments is empty", async () => {
    __seedPayout({ id: "pay-4", workspaceId: "ws-1", status: "completed" });

    const res = await request(app)
      .post("/lancepay/disputes")
      .send({ ...VALID_BODY, payoutId: "pay-4", evidenceAttachments: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EVIDENCE");
  });

  it("returns 400 when evidenceAttachments is not an array", async () => {
    __seedPayout({ id: "pay-5", workspaceId: "ws-1", status: "completed" });

    const res = await request(app)
      .post("/lancepay/disputes")
      .send({ ...VALID_BODY, payoutId: "pay-5", evidenceAttachments: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EVIDENCE");
  });

  it("returns 400 when evidenceAttachments contains empty strings", async () => {
    __seedPayout({ id: "pay-6", workspaceId: "ws-1", status: "completed" });

    const res = await request(app)
      .post("/lancepay/disputes")
      .send({ ...VALID_BODY, payoutId: "pay-6", evidenceAttachments: ["https://valid.com/file.png", ""] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EVIDENCE");
  });

  it("accepts all valid reason codes", async () => {
    const reasonCodes = Array.from(["unauthorized_transaction", "incorrect_amount", "duplicate_payment", "service_not_provided", "goods_not_received", "other"]);

    for (const code of reasonCodes) {
      __resetPayouts();
      __resetDisputes();
      __seedPayout({ id: `pay-${code}`, workspaceId: "ws-1", status: "completed" });

      const res = await request(app)
        .post("/lancepay/disputes")
        .send({ ...VALID_BODY, payoutId: `pay-${code}`, reasonCode: code });

      expect(res.status).toBe(201);
      expect(res.body.data.reasonCode).toBe(code);
    }
  });
});