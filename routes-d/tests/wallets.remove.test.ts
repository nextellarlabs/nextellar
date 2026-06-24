import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import walletsRemoveRouter, {
  __resetWallets,
  __addWallet,
  __getUserWallets,
} from "../routes/wallets.remove.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    const userId = req.headers["user-sub"];
    if (userId) {
      req.user = { sub: userId as string };
    }
    next();
  });
  app.use(walletsRemoveRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("DELETE /wallets/:id", () => {
  const app = buildApp();

  const validWallet = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI";
  const otherWallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const userId = "test-user-123";

  beforeEach(() => {
    __resetWallets();
    __addWallet(userId, validWallet);
    __addWallet(userId, otherWallet);
  });

  function makeReq(walletId: string, confirmed = false) {
    return request(app)
      .delete(`/wallets/${walletId}`)
      .set("user-sub", userId)
      .send({ confirmed });
  }

  it("removes a wallet successfully", async () => {
    const res = await makeReq(validWallet);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.removed).toBe(validWallet);
    expect(res.body.data.remainingWallets).toEqual([otherWallet]);
  });

  it("returns 403 when wallet is not linked to the user", async () => {
    const res = await request(app)
      .delete("/wallets/GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")
      .set("user-sub", userId);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("blocks removal of the last wallet without confirmation", async () => {
    __resetWallets();
    __addWallet(userId, validWallet);

    const res = await makeReq(validWallet, false);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LAST_WALLET_REMOVAL_BLOCKED");
  });

  it("allows removal of the last wallet with confirmation", async () => {
    __resetWallets();
    __addWallet(userId, validWallet);

    const res = await makeReq(validWallet, true);

    expect(res.status).toBe(200);
    expect(res.body.data.remainingWallets).toEqual([]);
  });

  it("returns 400 for invalid wallet format", async () => {
    const res = await request(app)
      .delete("/wallets/invalid")
      .set("user-sub", userId);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ADDRESS");
  });

  it("returns 403 when requesting removal of unlinked wallet with only one wallet present", async () => {
    __resetWallets();
    __addWallet(userId, validWallet);

    const res = await makeReq(otherWallet, false);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});