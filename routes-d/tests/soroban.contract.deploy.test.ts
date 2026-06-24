import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import deployRouter, {
  __resetDeploy,
  __addWasmHash,
} from "../routes/soroban.contract.deploy.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(deployRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_HASH = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
const INVALID_HASH = "not-a-hex-hash";
const UNKNOWN_HASH = "0".repeat(64);

describe("POST /soroban/contract/deploy", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetDeploy();
  });

  it("returns 201 with contractId on successful deployment", async () => {
    const res = await request(app).post("/soroban/contract/deploy").send({
      wasmHash: VALID_HASH,
      salt: "deploy-salt-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBeDefined();
    expect(typeof res.body.data.contractId).toBe("string");
  });

  it("returns 409 DUPLICATE_SALT when the same wasmHash+salt pair is deployed twice", async () => {
    await request(app).post("/soroban/contract/deploy").send({
      wasmHash: VALID_HASH,
      salt: "duplicate-salt",
    });

    const res = await request(app).post("/soroban/contract/deploy").send({
      wasmHash: VALID_HASH,
      salt: "duplicate-salt",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_SALT");
  });

  it("returns 400 INVALID_WASM_HASH for a malformed wasm hash", async () => {
    const res = await request(app).post("/soroban/contract/deploy").send({
      wasmHash: INVALID_HASH,
      salt: "some-salt",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WASM_HASH");
  });

  it("returns 404 WASM_NOT_FOUND for a valid but unknown wasm hash", async () => {
    const res = await request(app).post("/soroban/contract/deploy").send({
      wasmHash: UNKNOWN_HASH,
      salt: "some-salt",
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WASM_NOT_FOUND");
  });

  it("returns 400 MISSING_FIELDS when wasmHash is absent", async () => {
    const res = await request(app).post("/soroban/contract/deploy").send({
      salt: "some-salt",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 MISSING_FIELDS when salt is absent", async () => {
    const res = await request(app).post("/soroban/contract/deploy").send({
      wasmHash: VALID_HASH,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("allows same salt with a different wasmHash (salt scope is per wasm)", async () => {
    const secondHash = "f".repeat(64);
    __addWasmHash(secondHash);

    await request(app).post("/soroban/contract/deploy").send({
      wasmHash: VALID_HASH,
      salt: "shared-salt",
    });

    const res = await request(app).post("/soroban/contract/deploy").send({
      wasmHash: secondHash,
      salt: "shared-salt",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.contractId).toBeDefined();
  });
});
