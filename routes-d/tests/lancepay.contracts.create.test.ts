import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __resetContracts, __getContracts } from "../routes/lancepay.contracts.create.js";

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
  workspaceId: "ws-1",
  contractorId: "con-1",
  rate: 150.0,
  currency: "USD",
  term: "6 months",
  jurisdiction: "CA",
};

describe("POST /lancepay/contracts", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContracts();
  });

  it("creates a contract with valid data", async () => {
    const res = await request(app).post("/lancepay/contracts").send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.status).toBe("draft");
  });

  it("fails validation for missing rate", async () => {
    const { rate, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/contracts").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RATE");
  });

  it("fails validation for missing term", async () => {
    const { term, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/contracts").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TERM");
  });

  it("fails validation for missing jurisdiction", async () => {
    const { jurisdiction, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/contracts").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JURISDICTION");
  });

  it("is idempotent against duplicate creation by content hash", async () => {
    const first = await request(app).post("/lancepay/contracts").send(VALID_BODY);
    expect(first.status).toBe(201);
    const contractId = first.body.data.id;

    const second = await request(app).post("/lancepay/contracts").send(VALID_BODY);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.data.id).toBe(contractId);

    expect(__getContracts().size).toBe(1);
  });
});
