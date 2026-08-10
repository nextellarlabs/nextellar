import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetW8Records,
  __getW8Records,
} from "../routes/lancepay.tax.w8.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS_ID = "ws-acmecorp";
const CON_ID = "con-hiroshi";

/** Minimal valid W-8BEN body (no treaty claim). */
const VALID_BODY_NO_TREATY = {
  workspaceId: WS_ID,
  contractorId: CON_ID,
  name: "Hiroshi Tanaka",
  country: "JP",
  foreignTin: "JP-12345678",
  claimTaxTreaty: false,
  signedAt: "2026-04-01T09:00:00Z",
};

/** Valid W-8BEN body with a treaty claim (Japan–US treaty). */
const VALID_BODY_WITH_TREATY = {
  ...VALID_BODY_NO_TREATY,
  claimTaxTreaty: true,
  treatyArticle: "12",
  treatyRate: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /lancepay/tax-forms/w8", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetW8Records();
  });

  // -------------------------------------------------------------------------
  // Happy path: submit without treaty claim
  // -------------------------------------------------------------------------

  it("accepts a valid W-8BEN submission without a treaty claim", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.id).toBeDefined();
    expect(data.workspaceId).toBe(WS_ID);
    expect(data.contractorId).toBe(CON_ID);
    expect(data.country).toBe("JP");
    expect(data.claimTaxTreaty).toBe(false);
    expect(data.signedAt).toBe("2026-04-01T09:00:00Z");
    expect(data.submittedAt).toBeDefined();
    expect(data.encryptKeyId).toBe("LANCEPAY_W8_ENCRYPT_KEY_V1");

    // Treaty fields should not be present when not claimed
    expect(data.treatyArticle).toBeUndefined();
    expect(data.treatyRate).toBeUndefined();
  });

  it("stores the record in the in-memory store after successful submission", async () => {
    await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    expect(__getW8Records().size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Happy path: submit with treaty claim
  // -------------------------------------------------------------------------

  it("accepts a valid W-8BEN submission with a treaty claim", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_WITH_TREATY);

    expect(res.status).toBe(201);

    const data = res.body.data;
    expect(data.claimTaxTreaty).toBe(true);
    expect(data.treatyArticle).toBe("12");
    expect(data.treatyRate).toBe(0);
  });

  it("workspace owner can submit a W-8BEN on behalf of a contractor", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-workspace-id", WS_ID)
      .send(VALID_BODY_NO_TREATY);

    expect(res.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // Encryption: sensitive fields must NOT be stored in plaintext
  // -------------------------------------------------------------------------

  it("does not store name in plaintext — it must be encrypted", async () => {
    await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    const records = Array.from(__getW8Records().values());
    expect(records).toHaveLength(1);

    const stored = records[0];
    // name should be an encrypted envelope, not the raw string
    expect(typeof stored.name).toBe("object");
    expect(stored.name).toHaveProperty("keyId", "LANCEPAY_W8_ENCRYPT_KEY_V1");
    expect(stored.name).toHaveProperty("iv");
    expect(stored.name).toHaveProperty("tag");
    expect(stored.name).toHaveProperty("ciphertext");
    // Raw value must not appear in the stored object
    expect(JSON.stringify(stored.name)).not.toContain("Hiroshi Tanaka");
  });

  it("does not store foreignTin in plaintext — it must be encrypted", async () => {
    await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    const records = Array.from(__getW8Records().values());
    const stored = records[0];

    expect(typeof stored.foreignTin).toBe("object");
    expect(stored.foreignTin).toHaveProperty("keyId", "LANCEPAY_W8_ENCRYPT_KEY_V1");
    expect(JSON.stringify(stored.foreignTin)).not.toContain("JP-12345678");
  });

  it("response does not expose plaintext name or foreignTin", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Hiroshi Tanaka");
    expect(body).not.toContain("JP-12345678");
  });

  // -------------------------------------------------------------------------
  // Missing treaty fields (claimTaxTreaty = true but article/rate absent)
  // -------------------------------------------------------------------------

  it("returns 400 when claimTaxTreaty is true but treatyArticle is missing", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, claimTaxTreaty: true, treatyRate: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TREATY_ARTICLE");
  });

  it("returns 400 when claimTaxTreaty is true but treatyRate is missing", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, claimTaxTreaty: true, treatyArticle: "12" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TREATY_RATE");
  });

  it("returns 400 when treatyRate is out of range (> 100)", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({
        ...VALID_BODY_NO_TREATY,
        claimTaxTreaty: true,
        treatyArticle: "12",
        treatyRate: 150,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TREATY_RATE");
  });

  it("returns 400 when treatyRate is negative", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({
        ...VALID_BODY_NO_TREATY,
        claimTaxTreaty: true,
        treatyArticle: "12",
        treatyRate: -5,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TREATY_RATE");
  });

  // -------------------------------------------------------------------------
  // Country validation
  // -------------------------------------------------------------------------

  it("returns 400 when country code is invalid", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, country: "XX" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COUNTRY");
  });

  it("returns 400 when country is missing", async () => {
    const { country: _c, ...bodyWithoutCountry } = VALID_BODY_NO_TREATY;
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(bodyWithoutCountry);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_COUNTRY");
  });

  it("accepts country codes case-insensitively", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, country: "jp" });

    expect(res.status).toBe(201);
    expect(res.body.data.country).toBe("JP");
  });

  // -------------------------------------------------------------------------
  // Signature timestamp validation
  // -------------------------------------------------------------------------

  it("returns 400 when signedAt is not a valid ISO-8601 timestamp", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, signedAt: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIGNED_AT");
  });

  it("returns 400 when signedAt is missing", async () => {
    const { signedAt: _s, ...bodyWithoutSignedAt } = VALID_BODY_NO_TREATY;
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(bodyWithoutSignedAt);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_SIGNED_AT");
  });

  // -------------------------------------------------------------------------
  // Missing required fields
  // -------------------------------------------------------------------------

  it("returns 400 when name is missing", async () => {
    const { name: _n, ...body } = VALID_BODY_NO_TREATY;
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_NAME");
  });

  it("returns 400 when foreignTin is missing", async () => {
    const { foreignTin: _f, ...body } = VALID_BODY_NO_TREATY;
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_FOREIGN_TIN");
  });

  it("returns 400 when claimTaxTreaty is not a boolean", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, claimTaxTreaty: "yes" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CLAIM_TAX_TREATY");
  });

  // -------------------------------------------------------------------------
  // Unauthorized contractor
  // -------------------------------------------------------------------------

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .send(VALID_BODY_NO_TREATY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_AUTH");
  });

  it("returns 403 when x-caller-id does not match the contractorId", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", "con-mallory")
      .send(VALID_BODY_NO_TREATY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when x-workspace-id does not match the workspaceId", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-workspace-id", "ws-attacker")
      .send(VALID_BODY_NO_TREATY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 when workspaceId is missing from body", async () => {
    const { workspaceId: _w, ...body } = VALID_BODY_NO_TREATY;
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_WORKSPACE_ID");
  });

  it("returns 400 when contractorId is missing from body", async () => {
    const { contractorId: _c, ...body } = VALID_BODY_NO_TREATY;
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTRACTOR_ID");
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("treaty fields are not included in response when claimTaxTreaty is false", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    expect(res.body.data.treatyArticle).toBeUndefined();
    expect(res.body.data.treatyRate).toBeUndefined();
  });

  it("accepts a zero treatyRate (full exemption)", async () => {
    const res = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send({ ...VALID_BODY_NO_TREATY, claimTaxTreaty: true, treatyArticle: "7", treatyRate: 0 });

    expect(res.status).toBe(201);
    expect(res.body.data.treatyRate).toBe(0);
  });

  it("each submission is assigned a unique id", async () => {
    await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    const res2 = await request(app)
      .post("/lancepay/tax-forms/w8")
      .set("x-caller-id", CON_ID)
      .send(VALID_BODY_NO_TREATY);

    expect(__getW8Records().size).toBe(2);
    const ids = Array.from(__getW8Records().keys());
    expect(ids[0]).not.toBe(ids[1]);
    expect(res2.body.data.id).toBe(ids[1]);
  });
});
