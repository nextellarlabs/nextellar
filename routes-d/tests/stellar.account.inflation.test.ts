import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import inflationRouter, {
  __resetInflation,
  __addKnownAccount,
} from "../routes/stellar.account.inflation.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(inflationRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// Valid 56-char Stellar account IDs (G + 55 chars)
const SOURCE       = "G" + "B".repeat(55);
const KNOWN_DEST   = "G" + "C".repeat(55);
const UNKNOWN_ACCT = "G" + "A".repeat(55);

describe("POST /stellar/account/inflation", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetInflation();
    __addKnownAccount(SOURCE);
    __addKnownAccount(KNOWN_DEST);
  });

  it("returns 200 with unsignedEnvelope for a known destination account", async () => {
    const res = await request(app).post("/stellar/account/inflation").send({
      sourceAccount: SOURCE,
      destination: KNOWN_DEST,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unsignedEnvelope).toBeDefined();
    expect(res.body.data.destination).toBe(KNOWN_DEST);
    expect(res.body.data.sourceAccount).toBe(SOURCE);
  });

  it("returns 404 DESTINATION_NOT_FOUND for an unknown destination account", async () => {
    const res = await request(app).post("/stellar/account/inflation").send({
      sourceAccount: SOURCE,
      destination: UNKNOWN_ACCT,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DESTINATION_NOT_FOUND");
  });

  it("returns 400 SELF_DESTINATION when source and destination are the same account", async () => {
    const res = await request(app).post("/stellar/account/inflation").send({
      sourceAccount: SOURCE,
      destination: SOURCE,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SELF_DESTINATION");
  });

  it("returns 400 MISSING_FIELDS when sourceAccount is absent", async () => {
    const res = await request(app).post("/stellar/account/inflation").send({
      destination: KNOWN_DEST,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 MISSING_FIELDS when destination is absent", async () => {
    const res = await request(app).post("/stellar/account/inflation").send({
      sourceAccount: SOURCE,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 INVALID_DESTINATION for a malformed destination account ID", async () => {
    const res = await request(app).post("/stellar/account/inflation").send({
      sourceAccount: SOURCE,
      destination: "not-a-stellar-account",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION");
  });
});
