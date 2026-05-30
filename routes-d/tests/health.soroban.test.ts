import express, { type Express } from "express";
import request from "supertest";
import { createSorobanHealthRouter, type SorobanRpcLike } from "../routes/health.soroban.js";

function buildApp(rpc: SorobanRpcLike): Express {
  const app = express();
  app.use("/health", createSorobanHealthRouter({ rpc, sleep: async () => {} }));
  return app;
}

describe("GET /health/soroban", () => {
  it("returns healthy when the ledger advances", async () => {
    const rpc: SorobanRpcLike = {
      getLatestLedger: jest.fn()
        .mockResolvedValueOnce({ sequence: 100 })
        .mockResolvedValueOnce({ sequence: 101 }),
    };
    const res = await request(buildApp(rpc)).get("/health/soroban");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.previousLedger).toBe(100);
    expect(res.body.latestLedger).toBe(101);
  });

  it("returns stalled when the ledger does not advance", async () => {
    const rpc: SorobanRpcLike = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 100 }),
    };
    const res = await request(buildApp(rpc)).get("/health/soroban");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("stalled");
  });

  it("returns unreachable when the probe fails", async () => {
    const rpc: SorobanRpcLike = {
      getLatestLedger: jest.fn().mockRejectedValue(new Error("timeout")),
    };
    const res = await request(buildApp(rpc)).get("/health/soroban");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unreachable");
    expect(res.body.error).toMatch(/timeout/);
  });
});
