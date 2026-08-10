import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import recoveryInitRouter, {
  __getRecoveryNotifications,
  __resetRecoveryInit,
  __setGuardianReachable,
} from "../routes/wallets.recovery.init.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(recoveryInitRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-abc123";

const validRecovery = {
  walletId: "wallet-1",
  guardians: ["guardian-a@example.com", "guardian-b@example.com", "guardian-c@example.com"],
  threshold: 2,
};

describe("POST /wallets/recovery/init", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetRecoveryInit();
  });

  it("starts a recovery flow and notifies every guardian", async () => {
    const res = await request(app)
      .post("/wallets/recovery/init")
      .set("x-user-id", USER_ID)
      .send(validRecovery);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.recoveryId).toMatch(/^recovery_/);
    expect(res.body.data.guardiansNotified).toBe(3);
    expect(__getRecoveryNotifications()).toHaveLength(3);
  });

  it("rejects threshold values above the guardian count", async () => {
    const res = await request(app)
      .post("/wallets/recovery/init")
      .set("x-user-id", USER_ID)
      .send({ ...validRecovery, threshold: 4 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD");
    expect(__getRecoveryNotifications()).toHaveLength(0);
  });

  it("returns guardian unreachable when notification dispatch fails", async () => {
    __setGuardianReachable("guardian-b@example.com", false);

    const res = await request(app)
      .post("/wallets/recovery/init")
      .set("x-user-id", USER_ID)
      .send(validRecovery);

    expect(res.status).toBe(424);
    expect(res.body.error.code).toBe("GUARDIAN_UNREACHABLE");
    expect(__getRecoveryNotifications()).toHaveLength(1);
  });
});
