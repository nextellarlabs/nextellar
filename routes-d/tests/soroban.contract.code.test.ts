import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import contractCodeRouter, { __resetContractCode } from "../routes/soroban.contract.code.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(contractCodeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /soroban/contract/:id/code", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractCode();
  });

  const knownContractId = "CDLZFC3SYJYDZTKLLNVEGWZHEKU2F4GVWKHK5TCEAEAZUP23WGW3EID2";
  const unknownContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const knownArchivedId = "CBIELTK6UGFUGJSF3J4ZYQSSFAIS6HB3UDXF2BBZ7BYL6UGHYVHBXI73";

  it("returns 200 for known active contract with wasmHash and sourceCode", async () => {
    const res = await request(app).get(`/soroban/contract/${knownContractId}/code`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe(knownContractId);
    expect(res.body.data.wasmHash).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2");
    expect(res.body.data.sourceCode).toBe("// Sample Soroban contract source");
    expect(res.body.data.status).toBe("active");
  });

  it("returns 200 for known archived contract without sourceCode", async () => {
    const res = await request(app).get(`/soroban/contract/${knownArchivedId}/code`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe(knownArchivedId);
    expect(res.body.data.wasmHash).toBe("f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1");
    expect(res.body.data.sourceCode).toBeUndefined();
    expect(res.body.data.status).toBe("archived");
  });

  it("returns 200 with empty wasmHash for unknown contract", async () => {
    const res = await request(app).get(`/soroban/contract/${unknownContractId}/code`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe(unknownContractId);
    expect(res.body.data.wasmHash).toBe("");
    expect(res.body.data.status).toBe("archived");
  });

  it("returns 400 for invalid contract ID (too short)", async () => {
    const res = await request(app).get("/soroban/contract/INVALID/code");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });

  it("returns 400 for invalid contract ID (wrong prefix)", async () => {
    const res = await request(app).get("/soroban/contract/ABCDEF/code");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });

  it("caches response within TTL window", async () => {
    const firstRes = await request(app).get(`/soroban/contract/${knownContractId}/code`);
    expect(firstRes.status).toBe(200);

    const secondRes = await request(app).get(`/soroban/contract/${knownContractId}/code`);
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.wasmHash).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2");
  });

  it("returns 400 for missing contract ID", async () => {
    const res = await request(app).get("/soroban/contract/CJ/code");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });
});