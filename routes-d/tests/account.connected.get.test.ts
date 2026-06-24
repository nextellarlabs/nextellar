import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountsRouter, { __resetAccounts, __seedAccounts, LinkedAccount } from "../routes/account.connected.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const testAccounts: LinkedAccount[] = [
  { id: "wallet-1", type: "wallet", label: "My Stellar Wallet", lastUsedAt: "2024-01-15T10:00:00Z" },
  { id: "identity-1", type: "identity", label: "GitHub", lastUsedAt: "2024-01-20T10:00:00Z" },
  { id: "wallet-2", type: "wallet", label: "Cold Storage", lastUsedAt: "2024-01-10T10:00:00Z" },
];

describe("GET /account/connected", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAccounts();
  });

  it("returns 200 with empty accounts array when no accounts exist", async () => {
    const res = await request(app).get("/account/connected");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accounts).toEqual([]);
  });

  it("returns 200 with all accounts containing only id, type, label fields", async () => {
    __seedAccounts(testAccounts);

    const res = await request(app).get("/account/connected");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accounts).toHaveLength(3);
  });

  it("returns accounts sorted by lastUsedAt descending (most recent first)", async () => {
    __seedAccounts(testAccounts);

    const res = await request(app).get("/account/connected");

    expect(res.status).toBe(200);
    const accounts = res.body.data.accounts;
    expect(accounts[0].id).toBe("identity-1");
    expect(accounts[1].id).toBe("wallet-1");
    expect(accounts[2].id).toBe("wallet-2");
  });

  it("does not include lastUsedAt in response items", async () => {
    __seedAccounts(testAccounts);

    const res = await request(app).get("/account/connected");

    expect(res.status).toBe(200);
    for (const account of res.body.data.accounts) {
      expect(account).not.toHaveProperty("lastUsedAt");
    }
  });

  it("each account has a type field of wallet or identity", async () => {
    __seedAccounts(testAccounts);

    const res = await request(app).get("/account/connected");

    expect(res.status).toBe(200);
    for (const account of res.body.data.accounts) {
      expect(["wallet", "identity"]).toContain(account.type);
    }
  });

  it("each account has a label field", async () => {
    __seedAccounts(testAccounts);

    const res = await request(app).get("/account/connected");

    expect(res.status).toBe(200);
    for (const account of res.body.data.accounts) {
      expect(account.label).toBeDefined();
      expect(typeof account.label).toBe("string");
    }
  });
});
