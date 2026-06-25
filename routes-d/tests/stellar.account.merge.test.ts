import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import mergeRouter, {
  __resetMerge,
  __addAccount,
} from "../routes/stellar.account.merge.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(mergeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const SOURCE      = "G" + "B".repeat(55);
const DESTINATION = "G" + "C".repeat(55);
const UNKNOWN     = "G" + "A".repeat(55);

describe("POST /stellar/account/merge", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetMerge();
  });

  it("returns 200 with unsignedEnvelope when source has no trustlines/offers and destination is known", async () => {
    __addAccount(SOURCE, { hasTrustlines: false, hasOpenOffers: false });
    __addAccount(DESTINATION, { hasTrustlines: false, hasOpenOffers: false });

    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: SOURCE,
      destination: DESTINATION,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceAccount).toBe(SOURCE);
    expect(res.body.data.destination).toBe(DESTINATION);
    expect(res.body.data.unsignedEnvelope).toBe(`unsigned_merge_envelope_${SOURCE}_${DESTINATION}`);
  });

  it("returns 409 HAS_TRUSTLINES when source account has active trustlines", async () => {
    __addAccount(SOURCE, { hasTrustlines: true, hasOpenOffers: false });
    __addAccount(DESTINATION, { hasTrustlines: false, hasOpenOffers: false });

    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: SOURCE,
      destination: DESTINATION,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("HAS_TRUSTLINES");
  });

  it("returns 409 HAS_OPEN_OFFERS when source has open offers (no trustlines)", async () => {
    __addAccount(SOURCE, { hasTrustlines: false, hasOpenOffers: true });
    __addAccount(DESTINATION, { hasTrustlines: false, hasOpenOffers: false });

    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: SOURCE,
      destination: DESTINATION,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("HAS_OPEN_OFFERS");
  });

  it("returns 400 MISSING_FIELDS when sourceAccount is absent", async () => {
    const res = await request(app).post("/stellar/account/merge").send({
      destination: DESTINATION,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 MISSING_FIELDS when destination is absent", async () => {
    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: SOURCE,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 SELF_MERGE when source and destination are the same account", async () => {
    __addAccount(SOURCE, { hasTrustlines: false, hasOpenOffers: false });

    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: SOURCE,
      destination: SOURCE,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SELF_MERGE");
  });

  it("returns 400 INVALID_SOURCE_ACCOUNT for malformed source account", async () => {
    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: "not-a-stellar-account",
      destination: DESTINATION,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ACCOUNT");
  });

  it("returns 404 ACCOUNT_NOT_FOUND for unknown source account", async () => {
    __addAccount(DESTINATION, { hasTrustlines: false, hasOpenOffers: false });

    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: UNKNOWN,
      destination: DESTINATION,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("returns 404 DESTINATION_NOT_FOUND for unknown destination", async () => {
    __addAccount(SOURCE, { hasTrustlines: false, hasOpenOffers: false });

    const res = await request(app).post("/stellar/account/merge").send({
      sourceAccount: SOURCE,
      destination: UNKNOWN,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DESTINATION_NOT_FOUND");
  });
});
