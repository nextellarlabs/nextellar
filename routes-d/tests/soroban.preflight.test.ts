import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import preflightRouter, { __resetPreflight } from "../routes/soroban.preflight.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(preflightRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /soroban/preflight", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPreflight();
  });

  it("returns 200 with resourceEstimates and authorizationRequired for valid XDR", async () => {
    const validXdr = Buffer.from("valid_transaction_data").toString("base64");

    const res = await request(app).post("/soroban/preflight").send({ xdr: validXdr });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.resourceEstimates).toBeDefined();
    expect(res.body.data.authorizationRequired).toBe(false);
  });

  it("returns 422 SIMULATION_REVERT for revert XDR", async () => {
    const revertXdr = Buffer.from("revert_something").toString("base64");

    const res = await request(app).post("/soroban/preflight").send({ xdr: revertXdr });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("SIMULATION_REVERT");
    expect(res.body.error.message).toBe("Simulation reverted: contract execution failed");
  });

  it("returns 400 INVALID_XDR for non-base64 input", async () => {
    const res = await request(app)
      .post("/soroban/preflight")
      .send({ xdr: "not-valid-base64!!!" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_XDR");
    expect(res.body.error.message).toBe("XDR is malformed or not valid base64");
  });

  it("returns 400 MISSING_XDR when xdr is absent", async () => {
    const res = await request(app).post("/soroban/preflight").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_XDR");
  });

  it("response includes latestLedger and minResourceFee for valid XDR", async () => {
    const validXdr = Buffer.from("valid_transaction_data").toString("base64");

    const res = await request(app).post("/soroban/preflight").send({ xdr: validXdr });

    expect(res.status).toBe(200);
    expect(res.body.data.latestLedger).toBe(12345678);
    expect(res.body.data.minResourceFee).toBe("1000");
  });
});
