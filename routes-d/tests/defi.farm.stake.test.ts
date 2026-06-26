import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import farmStakeRouter, {
  __resetFarms,
  __registerFarm,
  __removeFarm,
} from "../routes/defi.farm.stake.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(farmStakeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

describe("POST /defi/farm/stake", () => {
  const app = buildApp();

  const validBody = {
    farmId: "phoenix-usdc-xlm",
    accountId: VALID_ACCOUNT,
    amount: "50.00",
  };

  beforeEach(() => {
    __resetFarms();
  });

  it("returns 201 with an unsigned envelope on a valid stake request", async () => {
    const res = await request(app).post("/defi/farm/stake").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("unsignedEnvelope");
    expect(typeof res.body.data.unsignedEnvelope).toBe("string");
    expect(res.body.data.unsignedEnvelope.length).toBeGreaterThan(0);
  });

  it("returns correct farm metadata in the response", async () => {
    const res = await request(app).post("/defi/farm/stake").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.farmId).toBe("phoenix-usdc-xlm");
    expect(res.body.data.protocol).toBe("Phoenix");
    expect(res.body.data.asset).toBe("USDC");
    expect(res.body.data.amount).toBe("50.00");
    expect(res.body.data.accountId).toBe(VALID_ACCOUNT);
  });

  it("returns 422 BELOW_MINIMUM_STAKE when amount is below the farm minimum", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ ...validBody, amount: "1.00" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("BELOW_MINIMUM_STAKE");
    expect(res.body.error.message).toContain("10.00");
  });

  it("accepts a stake amount exactly at the minimum", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ ...validBody, amount: "10.00" });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe("10.00");
  });

  it("returns 404 UNKNOWN_FARM for an unrecognised farm id", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ ...validBody, farmId: "nonexistent-farm" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_FARM");
  });

  it("works correctly for the aqua-xlm farm", async () => {
    const res = await request(app).post("/defi/farm/stake").send({
      farmId: "aqua-xlm",
      accountId: VALID_ACCOUNT,
      amount: "200.00",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.farmId).toBe("aqua-xlm");
    expect(res.body.data.protocol).toBe("Aqua");
  });

  it("returns 422 BELOW_MINIMUM_STAKE for aqua-xlm minimum violation (minimum 100)", async () => {
    const res = await request(app).post("/defi/farm/stake").send({
      farmId: "aqua-xlm",
      accountId: VALID_ACCOUNT,
      amount: "50.00",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("BELOW_MINIMUM_STAKE");
    expect(res.body.error.message).toContain("100.00");
  });

  it("returns 400 INVALID_FARM_ID when farmId is missing", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ accountId: VALID_ACCOUNT, amount: "50" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FARM_ID");
  });

  it("returns 400 INVALID_ACCOUNT_ID when accountId is missing", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ farmId: "phoenix-usdc-xlm", amount: "50" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 INVALID_ACCOUNT_ID when accountId is not a valid Stellar public key", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ ...validBody, accountId: "invalid-key" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 INVALID_AMOUNT when amount is missing", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ farmId: "phoenix-usdc-xlm", accountId: VALID_ACCOUNT });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 INVALID_AMOUNT when amount is zero", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ ...validBody, amount: "0" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 INVALID_AMOUNT when amount is negative", async () => {
    const res = await request(app)
      .post("/defi/farm/stake")
      .send({ ...validBody, amount: "-10" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app).post("/defi/farm/stake").send(validBody);

    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data).toHaveProperty("farmId");
    expect(data).toHaveProperty("farmName");
    expect(data).toHaveProperty("protocol");
    expect(data).toHaveProperty("asset");
    expect(data).toHaveProperty("amount");
    expect(data).toHaveProperty("accountId");
    expect(data).toHaveProperty("unsignedEnvelope");
  });

  it("the unsigned envelope encodes the account and amount", async () => {
    const res = await request(app).post("/defi/farm/stake").send(validBody);

    expect(res.status).toBe(201);
    const envelope: string = res.body.data.unsignedEnvelope;
    expect(envelope).toContain(VALID_ACCOUNT);
    expect(envelope).toContain("50.00");
  });

  it("returns 404 UNKNOWN_FARM after a registered farm is removed via __removeFarm", async () => {
    __removeFarm("phoenix-usdc-xlm");

    const res = await request(app).post("/defi/farm/stake").send(validBody);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_FARM");
  });

  it("reflects a newly registered farm via __registerFarm", async () => {
    __registerFarm({
      farmId: "test-farm",
      name: "Test Farm",
      protocol: "TestProtocol",
      asset: "TEST",
      minimumStake: "5.00",
      contractAddress: "CATESTFARM1CONTRACTADDRESSPLACEHOLDER001",
    });

    const res = await request(app).post("/defi/farm/stake").send({
      farmId: "test-farm",
      accountId: VALID_ACCOUNT,
      amount: "10.00",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.farmId).toBe("test-farm");
    expect(res.body.data.protocol).toBe("TestProtocol");
  });
});
