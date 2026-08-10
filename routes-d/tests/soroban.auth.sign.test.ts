import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import authSignRouter, {
  __getAllowlist,
  __getServerKey,
} from "../routes/soroban.auth.sign.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authSignRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /soroban/auth/sign", () => {
  const app = buildApp();
  const allowlist = __getAllowlist();

  it("successfully signs an authorized contract method", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        method: "transfer",
        args: ["arg1", "arg2"],
        nonce: "12345",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
    expect(res.body.data.method).toBe("transfer");
    expect(res.body.data.signature).toBeDefined();
    expect(typeof res.body.data.signature).toBe("string");
    expect(res.body.data.signedAt).toBeDefined();
  });

  it("returns 403 for unauthorized contract", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CUNAUTHORIZEDCONTRACT123456789ABCDEFGHIJKLMNOPQRST",
        method: "transfer",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED_CONTRACT");
    expect(res.body.error.message).toContain("not authorized for signing");
  });

  it("returns 403 for unauthorized method on authorized contract", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        method: "unauthorized_method",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED_METHOD");
    expect(res.body.error.message).toContain("not authorized for contract");
  });

  it("returns 400 when contractId is missing", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        method: "transfer",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTRACT_ID");
  });

  it("returns 400 when contractId is empty string", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "   ",
        method: "transfer",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTRACT_ID");
  });

  it("returns 400 when method is missing", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_METHOD");
  });

  it("returns 400 when method is empty string", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        method: "   ",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_METHOD");
  });

  it("successfully signs with minimal fields (no args or nonce)", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        method: "swap",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.signature).toBeDefined();
  });

  it("signature includes contract, method, and server key data", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        method: "approve",
        args: ["spender", "amount"],
        nonce: "nonce123",
      });

    expect(res.status).toBe(200);
    const signature = res.body.data.signature;
    
    // Decode the signature to verify it contains expected data
    const decoded = JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
    expect(decoded.contractId).toBe("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
    expect(decoded.method).toBe("approve");
    expect(decoded.args).toEqual(["spender", "amount"]);
    expect(decoded.nonce).toBe("nonce123");
    expect(decoded.serverKey).toBe(__getServerKey());
  });

  it("validates all allowlisted contracts can sign their permitted methods", async () => {
    const contractIds = Object.keys(allowlist);
    
    for (const contractId of contractIds) {
      const methods = allowlist[contractId];
      
      for (const method of methods) {
        const res = await request(app)
          .post("/soroban/auth/sign")
          .send({ contractId, method });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.contractId).toBe(contractId);
        expect(res.body.data.method).toBe(method);
      }
    }
  });

  it("returns 400 when contractId is not a string", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: 12345,
        method: "transfer",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTRACT_ID");
  });

  it("returns 400 when method is not a string", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        method: 12345,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_METHOD");
  });

  it("signedAt timestamp is a valid ISO 8601 date string", async () => {
    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        method: "mint",
      });

    expect(res.status).toBe(200);
    const signedAt = res.body.data.signedAt;
    expect(signedAt).toBeDefined();
    
    const date = new Date(signedAt);
    expect(date.toISOString()).toBe(signedAt);
    expect(date.getTime()).toBeGreaterThan(0);
  });

  it("handles complex args array in signature", async () => {
    const complexArgs = [
      { address: "GXXXXXXX", amount: "1000" },
      ["nested", "array"],
      null,
      123,
      true,
    ];

    const res = await request(app)
      .post("/soroban/auth/sign")
      .send({
        contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        method: "add_liquidity",
        args: complexArgs,
      });

    expect(res.status).toBe(200);
    const signature = res.body.data.signature;
    const decoded = JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
    expect(decoded.args).toEqual(complexArgs);
  });
});
