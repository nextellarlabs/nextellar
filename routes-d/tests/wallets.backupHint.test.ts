import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import backupHintRouter, {
  __resetHintStore,
  __getHint,
  MAX_BLOB_BYTES,
} from "../routes/wallets.backupHint.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(backupHintRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /wallets/backup-hint", () => {
  const app = buildApp();

  const validRequest = {
    walletId: "wallet-abc",
    ciphertext: "U2FsdGVkX1+encryptedpayloadhere==",
  };

  const authHeader = { "x-user-id": "user-xyz" };

  beforeEach(() => {
    __resetHintStore();
  });

  it("returns 201 with walletId and storedAt on a valid request", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.walletId).toBe(validRequest.walletId);
    expect(typeof res.body.data.storedAt).toBe("string");
    expect(new Date(res.body.data.storedAt).getTime()).not.toBeNaN();
  });

  it("does not echo the ciphertext back in the response body", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty("ciphertext");
    expect(JSON.stringify(res.body)).not.toContain(validRequest.ciphertext);
  });

  it("accepts a ciphertext exactly at MAX_BLOB_BYTES length", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ...validRequest, ciphertext: "a".repeat(MAX_BLOB_BYTES) });

    expect(res.status).toBe(201);
  });

  it("returns 400 BLOB_TOO_LARGE when ciphertext exceeds MAX_BLOB_BYTES", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ...validRequest, ciphertext: "a".repeat(MAX_BLOB_BYTES + 1) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BLOB_TOO_LARGE");
  });

  it("returns 401 UNAUTHORIZED when x-user-id header is missing", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .send(validRequest);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_WALLET_ID when walletId is empty", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ...validRequest, walletId: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ID");
  });

  it("returns 400 INVALID_WALLET_ID when walletId is missing", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ciphertext: validRequest.ciphertext });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ID");
  });

  it("returns 400 INVALID_CIPHERTEXT when ciphertext is empty", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ...validRequest, ciphertext: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CIPHERTEXT");
  });

  it("returns 400 INVALID_CIPHERTEXT when ciphertext is missing", async () => {
    const res = await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ walletId: validRequest.walletId });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CIPHERTEXT");
  });

  it("overwrites an existing hint for the same walletId (upsert)", async () => {
    await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ...validRequest, ciphertext: "first-ciphertext" });

    await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send({ ...validRequest, ciphertext: "second-ciphertext" });

    const stored = __getHint(validRequest.walletId);
    expect(stored?.ciphertext).toBe("second-ciphertext");
  });

  it("__getHint returns the stored record including ciphertext", async () => {
    await request(app)
      .post("/wallets/backup-hint")
      .set(authHeader)
      .send(validRequest);

    const stored = __getHint(validRequest.walletId);

    expect(stored).toBeDefined();
    expect(stored?.walletId).toBe(validRequest.walletId);
    expect(stored?.ciphertext).toBe(validRequest.ciphertext);
    expect(typeof stored?.storedAt).toBe("string");
  });
});
