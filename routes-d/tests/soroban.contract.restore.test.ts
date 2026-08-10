import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import restoreRouter, { __resetContracts } from "../routes/soroban.contract.restore.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(restoreRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /soroban/contract/restore", () => {
  const app = buildApp();
  beforeEach(() => { __resetContracts(); });

  it("returns 200 with feeEstimate and unsignedEnvelope for an archived contract", async () => {
    const res = await request(app)
      .post("/soroban/contract/restore")
      .send({ contractId: "archived-001", sourceAccount: "GABC1234" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe("archived-001");
    expect(res.body.data.state).toBe("archived");
    expect(res.body.data.feeEstimate).toEqual({ stroops: 500, xlm: "0.0000050" });
    expect(res.body.data.unsignedEnvelope).toBe("unsigned_restore_envelope_archived-001_GABC1234");
  });

  it("returns 409 CONTRACT_ALREADY_ACTIVE for an active contract", async () => {
    const res = await request(app)
      .post("/soroban/contract/restore")
      .send({ contractId: "active-001", sourceAccount: "GABC1234" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONTRACT_ALREADY_ACTIVE");
    expect(res.body.error.message).toBe("Contract is already active and does not need restoration");
  });

  it("returns 404 CONTRACT_NOT_FOUND for an unknown contract", async () => {
    const res = await request(app)
      .post("/soroban/contract/restore")
      .send({ contractId: "xyz-999", sourceAccount: "GABC1234" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CONTRACT_NOT_FOUND");
    expect(res.body.error.message).toBe("Contract not found or state cannot be determined");
  });

  it("returns 400 MISSING_FIELDS when contractId is missing", async () => {
    const res = await request(app)
      .post("/soroban/contract/restore")
      .send({ sourceAccount: "GABC1234" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 MISSING_FIELDS when sourceAccount is missing", async () => {
    const res = await request(app)
      .post("/soroban/contract/restore")
      .send({ contractId: "archived-001" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });
});
