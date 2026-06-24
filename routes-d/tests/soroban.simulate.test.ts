import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import simulateRouter, {
  __resetSimulate,
  __setRpcAvailable,
  __setRevertError,
} from "../routes/soroban.simulate.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(simulateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_XDR = "AAAAAgAAAABzdGVsbGFyeGRy";
const INVALID_XDR = "not valid xdr!!";

describe("POST /soroban/simulate", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSimulate();
  });

  it("returns 200 with gasEstimate and footprint on valid XDR", async () => {
    const res = await request(app).post("/soroban/simulate").send({
      xdr: VALID_XDR,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.gasEstimate).toBeDefined();
    expect(typeof res.body.data.gasEstimate).toBe("number");
    expect(res.body.data.footprint).toBeDefined();
    expect(res.body.data.footprint.readBytes).toBeDefined();
    expect(res.body.data.footprint.writeBytes).toBeDefined();
    expect(res.body.data.footprint.ledgerEntries).toBeDefined();
    expect(res.body.data.latestLedger).toBeDefined();
  });

  it("returns 400 INVALID_XDR for malformed XDR input", async () => {
    const res = await request(app).post("/soroban/simulate").send({
      xdr: INVALID_XDR,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_XDR");
  });

  it("returns 400 MISSING_FIELDS when xdr is absent", async () => {
    const res = await request(app).post("/soroban/simulate").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 422 CONTRACT_REVERT when RPC returns a revert error", async () => {
    __setRevertError("insufficient balance to pay fees");

    const res = await request(app).post("/soroban/simulate").send({
      xdr: VALID_XDR,
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTRACT_REVERT");
    expect(res.body.error.message).toContain("insufficient balance");
  });

  it("returns 503 RPC_UNAVAILABLE when RPC is down", async () => {
    __setRpcAvailable(false);

    const res = await request(app).post("/soroban/simulate").send({
      xdr: VALID_XDR,
    });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("RPC_UNAVAILABLE");
  });
});
