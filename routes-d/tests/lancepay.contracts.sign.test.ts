import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContract,
  __getContract,
  __resetContracts,
} from "../routes/lancepay.contracts.sign.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const BASE_CONTRACT = {
  id: "contract-1",
  workspaceId: "ws-1",
  contractorId: "con-1",
  content: "Full-stack development, 12 months, $100/hr",
};

describe("POST /lancepay/contracts/:id/sign", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContracts();
    __seedContract(BASE_CONTRACT);
  });

  it("signs a contract with a valid workspace owner signer", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "ws-1", intentToken: "tok-abc-123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBe("contract-1");
    expect(res.body.data.signedBy).toBe("ws-1");
    expect(res.body.data).toHaveProperty("signedHash");
    expect(res.body.data).toHaveProperty("signedAt");
    expect(typeof res.body.data.signedHash).toBe("string");
    expect(res.body.data.signedHash.length).toBeGreaterThan(0);
  });

  it("signs a contract with the assigned contractor signer", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "con-1", intentToken: "tok-xyz-789" });

    expect(res.status).toBe(200);
    expect(res.body.data.signedBy).toBe("con-1");
    const stored = __getContract("contract-1")!;
    expect(stored.signedBy).toBe("con-1");
    expect(stored.signedHash).toBeDefined();
    expect(stored.signedAt).toBeDefined();
  });

  it("returns 409 when the contract is already signed", async () => {
    await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "ws-1", intentToken: "tok-first" });

    const res = await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "ws-1", intentToken: "tok-second" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_SIGNED");
  });

  it("returns 403 when signer is not authorized", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "intruder-99", intentToken: "tok-bad" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED_SIGNER");
  });

  it("returns 404 for unknown contract id", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/nonexistent/sign")
      .send({ signerId: "ws-1", intentToken: "tok-abc" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when signerId is missing", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ intentToken: "tok-abc" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIGNER_ID");
  });

  it("returns 400 when intentToken is missing", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "ws-1" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INTENT_TOKEN");
  });

  it("persists a tamper-evident signed hash on the contract", async () => {
    await request(app)
      .post("/lancepay/contracts/contract-1/sign")
      .send({ signerId: "ws-1", intentToken: "tok-tamper-test" });

    const stored = __getContract("contract-1")!;
    expect(stored.signedHash).toBeDefined();
    expect(stored.signedHash!.length).toBe(64); // SHA-256 hex digest
    expect(stored.signedAt).toBeDefined();
  });
});
