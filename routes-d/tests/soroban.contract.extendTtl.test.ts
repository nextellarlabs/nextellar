import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import extendTtlRouter, {
  __resetContractTtls,
  __seedContractTtl,
} from "../routes/soroban.contract.extendTtl.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(extendTtlRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /soroban/contract/extend-ttl", () => {
  const app = buildApp();

  const contractId = "contract-123";

  beforeEach(() => {
    __resetContractTtls();
    __seedContractTtl(contractId, 1000);
  });

  it("extends TTL and returns unsigned envelope", async () => {
    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      contractId,
      ledgerCount: 500,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ttl).toBe(1500);
    expect(res.body.data.envelope).toBeDefined();
    expect(res.body.data.envelope.type).toBe("extend_ttl_envelope");
    expect(res.body.data.envelope.newTtl).toBe(1500);
    expect(res.body.data.envelope.signatures).toEqual([]);
  });

  it("returns 400 for invalid ledgerCount", async () => {
    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      contractId,
      ledgerCount: 0,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LEDGER_COUNT");
  });

  it("returns 400 when ledgerCount exceeds cap", async () => {
    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      contractId,
      ledgerCount: 1000000,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TTL_CAP_EXCEEDED");
  });

  it("returns 400 for unknown contract/entry", async () => {
    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      contractId: "unknown-contract",
      ledgerCount: 100,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_ENTRY");
  });

  it("allows extending for known entry with entryKey", async () => {
    __seedContractTtl("entry-abc", 500);

    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      contractId: "entry-abc",
      entryKey: "key1",
      ledgerCount: 100,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.ttl).toBe(600);
  });

  it("enforces overall TTL cap after extension", async () => {
    __seedContractTtl(contractId, 1500000);

    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      contractId,
      ledgerCount: 100,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TTL_CAP_EXCEEDED");
  });

  it("returns 400 when contractId is missing", async () => {
    const res = await request(app).post("/soroban/contract/extend-ttl").send({
      ledgerCount: 100,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });
});