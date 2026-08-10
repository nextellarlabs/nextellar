import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import sorobanContractABIRouter, { __clearABICache, __getABICache } from "../routes/soroban.contract.abi.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(sorobanContractABIRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /soroban/contract/:id/abi", () => {
  const app = buildApp();

  beforeEach(() => {
    __clearABICache();
  });

  it("returns ABI for a valid contract ID", async () => {
    const res = await request(app).get("/soroban/contract/CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4/abi");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("functions");
    expect(res.body.data).toHaveProperty("metadata");
    expect(res.body.cached).toBe(false);
  });

  it("returns 400 when contract ID is missing", async () => {
    const res = await request(app).get("/soroban/contract//abi");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });

  it("returns 400 when contract ID does not start with C", async () => {
    const res = await request(app).get("/soroban/contract/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4/abi");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });

  it("caches ABI lookup on successful request", async () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    const res1 = await request(app).get(`/soroban/contract/${contractId}/abi`);

    expect(res1.status).toBe(200);
    expect(res1.body.cached).toBe(false);

    const res2 = await request(app).get(`/soroban/contract/${contractId}/abi`);

    expect(res2.status).toBe(200);
    expect(res2.body.cached).toBe(true);
    expect(res2.body.data).toEqual(res1.body.data);
  });

  it("returns same cached data across requests", async () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    const res1 = await request(app).get(`/soroban/contract/${contractId}/abi`);
    const data1 = res1.body.data;

    const res2 = await request(app).get(`/soroban/contract/${contractId}/abi`);
    const data2 = res2.body.data;

    expect(data1).toEqual(data2);
    expect(__getABICache().has(contractId)).toBe(true);
  });
});
