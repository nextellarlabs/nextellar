import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import defiFarmUnstakeRouter, {
  __seedFarmPosition,
  __resetFarmPositions,
} from "../routes/defi.farm.unstake.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(defiFarmUnstakeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

const USER_ID = "user-defi-001";
const FARM_ID = "farm-xlm-usdc";

beforeEach(() => {
  __resetFarmPositions();
  __seedFarmPosition({
    userId: USER_ID,
    farmId: FARM_ID,
    stakedAmount: 1000,
    asset: "XLM",
  });
});

describe("POST /defi/farm/unstake – full unstake", () => {
  it("unstakes the full staked amount and clears the position", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", USER_ID)
      .send({ farmId: FARM_ID, amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unstakedAmount).toBe(1000);
    expect(res.body.data.remainingStake).toBe(0);
    expect(res.body.data.envelope).toContain("1000");
    expect(res.body.data.envelope).toContain(FARM_ID);
  });
});

describe("POST /defi/farm/unstake – partial unstake", () => {
  it("unstakes partial amount and returns remaining stake", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", USER_ID)
      .send({ farmId: FARM_ID, amount: 400 });

    expect(res.status).toBe(200);
    expect(res.body.data.unstakedAmount).toBe(400);
    expect(res.body.data.remainingStake).toBe(600);
    expect(res.body.data.asset).toBe("XLM");
  });
});

describe("POST /defi/farm/unstake – over-amount rejection", () => {
  it("rejects unstake amount greater than staked balance", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", USER_ID)
      .send({ farmId: FARM_ID, amount: 1500 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INSUFFICIENT_STAKE");
  });

  it("rejects when user has no position in the farm", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", "user-no-stake")
      .send({ farmId: FARM_ID, amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NO_POSITION");
  });

  it("rejects missing x-user-id", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .send({ farmId: FARM_ID, amount: 100 });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects missing farmId", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", USER_ID)
      .send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FARM_ID");
  });

  it("rejects zero amount", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", USER_ID)
      .send({ farmId: FARM_ID, amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("rejects negative amount", async () => {
    const res = await request(app)
      .post("/defi/farm/unstake")
      .set("x-user-id", USER_ID)
      .send({ farmId: FARM_ID, amount: -50 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });
});
