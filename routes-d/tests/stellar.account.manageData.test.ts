import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import manageDataRouter, { __resetManageData } from "../routes/stellar.account.manageData.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(manageDataRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const SOURCE = "G" + "B".repeat(55);

describe("POST /stellar/account/manage-data", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetManageData();
  });

  it("returns 200 with operation: set and unsignedEnvelope when dataValue is provided", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: SOURCE,
      dataKey: "my-key",
      dataValue: "bXktdmFsdWU=",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operation).toBe("set");
    expect(res.body.data.dataKey).toBe("my-key");
    expect(res.body.data.sourceAccount).toBe(SOURCE);
    expect(res.body.data.unsignedEnvelope).toBe(`unsigned_manage_data_envelope_${SOURCE}_my-key_set`);
  });

  it("returns 200 with operation: clear when dataValue is null", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: SOURCE,
      dataKey: "my-key",
      dataValue: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operation).toBe("clear");
    expect(res.body.data.unsignedEnvelope).toBe(`unsigned_manage_data_envelope_${SOURCE}_my-key_clear`);
  });

  it("returns 200 with operation: clear when dataValue is absent", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: SOURCE,
      dataKey: "my-key",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operation).toBe("clear");
    expect(res.body.data.unsignedEnvelope).toBe(`unsigned_manage_data_envelope_${SOURCE}_my-key_clear`);
  });

  it("returns 400 KEY_TOO_LONG when dataKey exceeds 64 bytes", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: SOURCE,
      dataKey: "a".repeat(65),
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("KEY_TOO_LONG");
  });

  it("returns 400 VALUE_TOO_LARGE when decoded dataValue exceeds 64 bytes", async () => {
    const largeValue = Buffer.from("x".repeat(65)).toString("base64");
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: SOURCE,
      dataKey: "my-key",
      dataValue: largeValue,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALUE_TOO_LARGE");
  });

  it("returns 400 MISSING_FIELDS when sourceAccount is absent", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      dataKey: "my-key",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 MISSING_FIELDS when dataKey is absent", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: SOURCE,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FIELDS");
  });

  it("returns 400 INVALID_SOURCE_ACCOUNT for malformed account ID", async () => {
    const res = await request(app).post("/stellar/account/manage-data").send({
      sourceAccount: "not-a-stellar-account",
      dataKey: "my-key",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ACCOUNT");
  });
});
