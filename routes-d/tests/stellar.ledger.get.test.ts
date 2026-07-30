import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import ledgerRouter, {
  __resetLedgers,
  __addLedger,
  __setUnclosedSeq,
} from "../routes/stellar.ledger.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(ledgerRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const SAMPLE_LEDGER = {
  sequence: 12345,
  hash: "abc123def456",
  closedAt: "2025-01-01T00:00:00Z",
  totalTransactions: 5,
  totalOperations: 12,
  totalPayments: 3,
};

describe("GET /stellar/ledger/:seq", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetLedgers();
  });

  it("returns 200 with ledger header and operation counts for a known closed ledger", async () => {
    __addLedger(12345, SAMPLE_LEDGER);

    const res = await request(app).get("/stellar/ledger/12345");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sequence).toBe(12345);
    expect(res.body.data.hash).toBe("abc123def456");
    expect(res.body.data.closedAt).toBe("2025-01-01T00:00:00Z");
    expect(res.body.data.totalTransactions).toBe(5);
    expect(res.body.data.totalOperations).toBe(12);
    expect(res.body.data.totalPayments).toBe(3);
  });

  it("returns 400 INVALID_SEQUENCE for non-integer seq", async () => {
    const res = await request(app).get("/stellar/ledger/abc");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEQUENCE");
  });

  it("returns 400 INVALID_SEQUENCE for zero seq", async () => {
    const res = await request(app).get("/stellar/ledger/0");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEQUENCE");
  });

  it("returns 400 INVALID_SEQUENCE for negative seq", async () => {
    const res = await request(app).get("/stellar/ledger/-5");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEQUENCE");
  });

  it("returns 404 LEDGER_NOT_FOUND for unknown sequence", async () => {
    const res = await request(app).get("/stellar/ledger/99999");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("LEDGER_NOT_FOUND");
  });

  it("returns 425 LEDGER_NOT_CLOSED for a not-yet-closed ledger sequence", async () => {
    __setUnclosedSeq(55555);

    const res = await request(app).get("/stellar/ledger/55555");

    expect(res.status).toBe(425);
    expect(res.body.error.code).toBe("LEDGER_NOT_CLOSED");
  });
});
