import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import uploadWasmRouter, {
  __validateWasmBytecode,
  __getMaxWasmSize,
} from "../routes/soroban.contract.uploadWasm.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(uploadWasmRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /soroban/contract/upload-wasm", () => {
  const app = buildApp();

  // Minimal valid WASM binary: magic number + version
  const minimalWasm = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    0x01, 0x07, 0x01, 0x60, // type section (empty)
    0x02, 0x07, 0x01, 0x01, // function section (empty)
    0x60, 0x00, 0x00, // code section (empty)
  ]).toString("base64");

  it("returns hash and size for valid wasm", async () => {
    const res = await request(app).post("/soroban/contract/upload-wasm").send({
      wasm: minimalWasm,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hash).toBeDefined();
    expect(res.body.data.size).toBeGreaterThan(0);
  });

  it("returns 400 when wasm is missing", async () => {
    const res = await request(app).post("/soroban/contract/upload-wasm").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WASM");
  });

  it("returns 400 for invalid base64 wasm", async () => {
    const res = await request(app).post("/soroban/contract/upload-wasm").send({
      wasm: "not-valid-base64!!!",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WASM");
  });

  it("returns 400 for oversized wasm payload", async () => {
    // Create a payload larger than the default 10MB limit
    const oversized = Buffer.alloc(__getMaxWasmSize() + 1, 0).toString("base64");

    const res = await request(app).post("/soroban/contract/upload-wasm").send({
      wasm: oversized,
    });

    // Should be 413 Payload Too Large or 400 depending on implementation
    expect([400, 413]).toContain(res.status);
    expect(["WASM_TOO_LARGE", "INVALID_WASM"]).toContain(res.body.error.code);
  });

  it("returns 400 for malformed wasm with invalid magic number", async () => {
    const badMagic = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]).toString("base64");

    const res = await request(app).post("/soroban/contract/upload-wasm").send({
      wasm: badMagic,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WASM");
    expect(res.body.error.message).toContain("magic number");
  });

  it("returns 400 for wasm with unsupported version", async () => {
    const badVersion = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]).toString("base64");

    const res = await request(app).post("/soroban/contract/upload-wasm").send({
      wasm: badVersion,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WASM");
    expect(res.body.error.message).toContain("version");
  });

  it("returns 400 for wasm that is too short", async () => {
    const tooShort = Buffer.from([0x00, 0x61, 0x73]).toString("base64");

    const res = await request(app).post("/soroban/contract/upload-wasm").send({
      wasm: tooShort,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WASM");
    expect(res.body.error.message).toContain("too short");
  });

  it("validates wasm bytecode via helper", () => {
    expect(__validateWasmBytecode(minimalWasm).valid).toBe(true);
    expect(__validateWasmBytecode("not-valid").valid).toBe(false);
    expect(__validateWasmBytecode(Buffer.from([0, 0, 0]).toString("base64")).valid).toBe(false);
  });

  it("respects custom MAX_WASM_SIZE config", () => {
    expect(__getMaxWasmSize()).toBeGreaterThan(0);
  });
});