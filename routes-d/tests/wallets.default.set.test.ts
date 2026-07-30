import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import walletsDefaultSetRouter, {
  __resetDefaultWallets,
  __seedLinkedWallet,
  __getDefaultWallet,
} from "../routes/wallets.default.set.js";

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
  app.use(walletsDefaultSetRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /wallets/default", () => {
  const app = buildApp();

  const validWallet = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQLWGS4LO3H3EMEVBNQXVQSTKSUI";
  const userId = "test-user-123";

  beforeEach(() => {
    __resetDefaultWallets();
    __seedLinkedWallet(userId, validWallet);
  });

  it("sets the default wallet successfully", async () => {
    const res = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({ walletAddress: validWallet });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.defaultWallet).toBe(validWallet);
    expect(res.body.data.unchanged).toBe(false);
  });

  it("returns 400 when walletAddress is missing", async () => {
    const res = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ADDRESS");
  });

  it("returns 400 when walletAddress is not a valid Stellar public key", async () => {
    const res = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({ walletAddress: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ADDRESS");
  });

  it("returns 403 when the wallet is not linked to the caller", async () => {
    const res = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({ walletAddress: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns unchanged=true when setting the same default", async () => {
    __getDefaultWallet(userId);
    const first = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({ walletAddress: validWallet });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({ walletAddress: validWallet });
    expect(second.status).toBe(200);
    expect(second.body.data.unchanged).toBe(true);
    expect(second.body.data.defaultWallet).toBe(validWallet);
  });

  it("emits an audit event on set", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const res = await request(app)
      .post("/wallets/default")
      .set("user-sub", userId)
      .send({ walletAddress: validWallet });

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = consoleSpy.mock.calls[0][0] as string;
    const audit = JSON.parse(logArg);
    expect(audit.event).toBe("WALLET_DEFAULT_SET");
    expect(audit.userId).toBe(userId);
    expect(audit.unchanged).toBe(false);
    consoleSpy.mockRestore();
  });
});