import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import setOptionsRouter, { __resetSetOptions } from "../routes/stellar.account.setOptions.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(setOptionsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const SOURCE = "G" + "B".repeat(55);

describe("POST /stellar/account/set-options", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSetOptions();
  });

  it("returns 200 with unsignedEnvelope when setting authRequired flag", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      setFlags: {
        authRequired: true,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceAccount).toBe(SOURCE);
    expect(res.body.data.setFlags).toEqual({ authRequired: true });
    expect(res.body.data.unsignedEnvelope).toContain("setFlags:authRequired");
  });

  it("returns 200 with unsignedEnvelope when setting multiple flags", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      setFlags: {
        authRequired: true,
        authRevocable: true,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.setFlags).toEqual({ authRequired: true, authRevocable: true });
    expect(res.body.data.unsignedEnvelope).toContain("setFlags:");
  });

  it("returns 200 with unsignedEnvelope when clearing flags", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      clearFlags: {
        authRequired: true,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.clearFlags).toEqual({ authRequired: true });
    expect(res.body.data.unsignedEnvelope).toContain("clearFlags:authRequired");
  });

  it("returns 200 with unsignedEnvelope when changing thresholds", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 1,
        medium: 2,
        high: 3,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds).toEqual({ low: 1, medium: 2, high: 3 });
    expect(res.body.data.unsignedEnvelope).toContain("thresholds:low:1,medium:2,high:3");
  });

  it("returns 200 with unsignedEnvelope when setting only low threshold", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 5,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds).toEqual({ low: 5 });
    expect(res.body.data.unsignedEnvelope).toContain("thresholds:low:5");
  });

  it("returns 200 with unsignedEnvelope when setting home domain", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      homeDomain: "example.com",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.homeDomain).toBe("example.com");
    expect(res.body.data.unsignedEnvelope).toContain("homeDomain:example.com");
  });

  it("returns 200 with unsignedEnvelope when combining flags, thresholds, and home domain", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      setFlags: {
        authRequired: true,
      },
      thresholds: {
        low: 1,
        medium: 2,
        high: 3,
      },
      homeDomain: "example.com",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.setFlags).toEqual({ authRequired: true });
    expect(res.body.data.thresholds).toEqual({ low: 1, medium: 2, high: 3 });
    expect(res.body.data.homeDomain).toBe("example.com");
    expect(res.body.data.unsignedEnvelope).toBeDefined();
  });

  it("returns 400 INVALID_THRESHOLD_ORDER when low > medium", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 5,
        medium: 2,
        high: 3,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD_ORDER");
  });

  it("returns 400 INVALID_THRESHOLD_ORDER when medium > high", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 1,
        medium: 5,
        high: 3,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD_ORDER");
  });

  it("returns 400 INVALID_THRESHOLD_ORDER when low > high", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 5,
        medium: 2,
        high: 1,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD_ORDER");
  });

  it("returns 400 INVALID_THRESHOLD when threshold is negative", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: -1,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD");
  });

  it("returns 400 INVALID_THRESHOLD when threshold exceeds 255", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        high: 256,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD");
  });

  it("returns 400 INVALID_THRESHOLD when threshold is not an integer", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        medium: 1.5,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THRESHOLD");
  });

  it("returns 400 INVALID_HOME_DOMAIN when home domain exceeds 32 bytes", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      homeDomain: "a".repeat(33),
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_HOME_DOMAIN");
  });

  it("returns 400 INVALID_HOME_DOMAIN when home domain is not a string", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      homeDomain: 123,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_HOME_DOMAIN");
  });

  it("returns 400 MISSING_FIELDS when sourceAccount is absent", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      setFlags: {
        authRequired: true,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 INVALID_SOURCE_ACCOUNT for malformed account ID", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: "not-a-stellar-account",
      setFlags: {
        authRequired: true,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ACCOUNT");
  });

  it("returns 200 with unsignedEnvelope when no changes are specified", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unsignedEnvelope).toContain("noChanges");
  });

  it("returns 200 with unsignedEnvelope when home domain is empty string", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      homeDomain: "",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.homeDomain).toBe("");
  });

  it("returns 200 with unsignedEnvelope when thresholds are equal", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 5,
        medium: 5,
        high: 5,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds).toEqual({ low: 5, medium: 5, high: 5 });
  });

  it("returns 200 with unsignedEnvelope when threshold is 0", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        low: 0,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds).toEqual({ low: 0 });
  });

  it("returns 200 with unsignedEnvelope when threshold is 255", async () => {
    const res = await request(app).post("/stellar/account/set-options").send({
      sourceAccount: SOURCE,
      thresholds: {
        high: 255,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.thresholds).toEqual({ high: 255 });
  });
});
