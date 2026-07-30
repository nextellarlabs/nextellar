import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import walletsImportRouter, {
  __getImportedWallets,
  __getRevokedKeys,
  __addRevokedKey,
  __resetImportedWallets,
} from "../routes/wallets.import.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(walletsImportRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /wallets/import", () => {
  const app = buildApp();

  const validRequest = {
    publicKey: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    challenge: "challenge-string-12345",
    signature: "signature-string-abcdef-12345-xyz",
  };

  beforeEach(() => {
    __resetImportedWallets();
  });

  it("imports a wallet with valid data and verified challenge", async () => {
    const res = await request(app).post("/wallets/import").send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.publicKey).toBe(validRequest.publicKey);
    expect(res.body.data.importedAt).toBeDefined();
  });

  it("returns 400 when publicKey is missing", async () => {
    const { publicKey, ...req } = validRequest;
    const res = await request(app).post("/wallets/import").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PUBLIC_KEY");
  });

  it("returns 400 when publicKey is not a valid Stellar public key", async () => {
    const res = await request(app).post("/wallets/import").send({
      ...validRequest,
      publicKey: "INVALID_KEY",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PUBLIC_KEY");
  });

  it("returns 400 when challenge is missing", async () => {
    const { challenge, ...req } = validRequest;
    const res = await request(app).post("/wallets/import").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CHALLENGE");
  });

  it("returns 400 when signature is missing", async () => {
    const { signature, ...req } = validRequest;
    const res = await request(app).post("/wallets/import").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("returns 400 when signature is invalid (too short)", async () => {
    const res = await request(app).post("/wallets/import").send({
      ...validRequest,
      signature: "abc",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CHALLENGE_VERIFICATION_FAILED");
  });

  it("rejects importing a wallet that has already been imported", async () => {
    const res1 = await request(app).post("/wallets/import").send(validRequest);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post("/wallets/import").send(validRequest);
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe("WALLET_ALREADY_IMPORTED");
  });

  it("rejects importing a revoked key", async () => {
    __addRevokedKey(validRequest.publicKey);

    const res = await request(app).post("/wallets/import").send(validRequest);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("KEY_REVOKED");
  });

  it("maintains imported wallet mappings correctly", async () => {
    const res = await request(app).post("/wallets/import").send(validRequest);
    expect(res.status).toBe(201);

    const importedWallets = __getImportedWallets();
    expect(importedWallets.has(validRequest.publicKey)).toBe(true);
    expect(importedWallets.get(validRequest.publicKey)!.publicKey).toBe(validRequest.publicKey);
  });

  it("allows importing multiple different wallets", async () => {
    const wallet1 = {
      ...validRequest,
      publicKey: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    };

    const wallet2 = {
      ...validRequest,
      publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI",
    };

    const res1 = await request(app).post("/wallets/import").send(wallet1);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post("/wallets/import").send(wallet2);
    expect(res2.status).toBe(201);

    const importedWallets = __getImportedWallets();
    expect(importedWallets.size).toBe(2);
  });
});
