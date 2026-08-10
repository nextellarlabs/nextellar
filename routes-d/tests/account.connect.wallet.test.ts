import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountConnectWalletRouter, {
  __getLinkedWallets,
  __getWalletToAccount,
  __resetWallets,
} from "../routes/account.connect.wallet.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountConnectWalletRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /account/connect-wallet", () => {
  const app = buildApp();

  const validRequest = {
    accountId: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI",
    challenge: "challenge-string-12345",
    signature: "signature-string-abcdef-12345-xyz",
  };

  beforeEach(() => {
    __resetWallets();
  });

  it("links a wallet to an account with valid data", async () => {
    const res = await request(app).post("/account/connect-wallet").send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(validRequest.accountId);
    expect(res.body.data.walletAddress).toBe(validRequest.walletAddress);
    expect(res.body.data.linked).toBe(true);
  });

  it("returns 400 when accountId is missing", async () => {
    const req = { ...validRequest };
    delete req.accountId;
    const res = await request(app).post("/account/connect-wallet").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 when accountId is not a valid Stellar public key", async () => {
    const res = await request(app).post("/account/connect-wallet").send({
      ...validRequest,
      accountId: "INVALID_KEY",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 when walletAddress is missing", async () => {
    const req = { ...validRequest };
    delete req.walletAddress;
    const res = await request(app).post("/account/connect-wallet").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ADDRESS");
  });

  it("returns 400 when walletAddress is not a valid Stellar public key", async () => {
    const res = await request(app).post("/account/connect-wallet").send({
      ...validRequest,
      walletAddress: "INVALID_KEY",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ADDRESS");
  });

  it("returns 400 when challenge is missing", async () => {
    const req = { ...validRequest };
    delete req.challenge;
    const res = await request(app).post("/account/connect-wallet").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CHALLENGE");
  });

  it("returns 400 when signature is missing", async () => {
    const req = { ...validRequest };
    delete req.signature;
    const res = await request(app).post("/account/connect-wallet").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("returns 400 when signature is invalid (too short)", async () => {
    const res = await request(app).post("/account/connect-wallet").send({
      ...validRequest,
      signature: "abc",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects linking a wallet already attached to another account", async () => {
    const firstRequest = {
      accountId: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
      walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI",
      challenge: "challenge-1",
      signature: "signature-1-abcdef",
    };

    const secondRequest = {
      accountId: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI",
      challenge: "challenge-2",
      signature: "signature-2-abcdef",
    };

    const res1 = await request(app).post("/account/connect-wallet").send(firstRequest);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post("/account/connect-wallet").send(secondRequest);
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe("WALLET_ALREADY_LINKED");
  });

  it("returns 200 when linking a wallet already linked to the same account", async () => {
    const res1 = await request(app).post("/account/connect-wallet").send(validRequest);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post("/account/connect-wallet").send(validRequest);
    expect(res2.status).toBe(200);
    expect(res2.body.data.linked).toBe(true);
    expect(res2.body.data.message).toBe("Wallet was already linked to this account");
  });

  it("maintains linked wallet mappings correctly", async () => {
    const res = await request(app).post("/account/connect-wallet").send(validRequest);
    expect(res.status).toBe(201);

    const linkedWallets = __getLinkedWallets();
    expect(linkedWallets.has(validRequest.accountId)).toBe(true);
    expect(linkedWallets.get(validRequest.accountId)!.has(validRequest.walletAddress)).toBe(true);

    const walletToAccount = __getWalletToAccount();
    expect(walletToAccount.get(validRequest.walletAddress)).toBe(validRequest.accountId);
  });

  it("allows linking multiple wallets to the same account", async () => {
    const wallet1 = {
      ...validRequest,
      walletAddress: "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI",
    };

    const wallet2 = {
      ...validRequest,
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    };

    const res1 = await request(app).post("/account/connect-wallet").send(wallet1);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post("/account/connect-wallet").send(wallet2);
    expect(res2.status).toBe(201);

    const linkedWallets = __getLinkedWallets();
    const accountWallets = linkedWallets.get(validRequest.accountId)!;
    expect(accountWallets.size).toBe(2);
  });
});
