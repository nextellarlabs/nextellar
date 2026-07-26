import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountsProfileRouter, {
  __resetAccounts,
  __seedAccount,
  __setDisplayName,
} from "../routes/accounts.profile.js";

const KNOWN_ACCOUNT_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNZ";
const KNOWN_ACCOUNT_NO_DOMAIN = "GBRP6K5FQ4U3YNC6XKX5XVH6F5GX5X5X5X5X5X5X5X5X5X5X5X5X5X5X";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountsProfileRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /accounts/:id/profile", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAccounts();
  });

  it("returns public profile for a known account with full on-chain data", async () => {
    const res = await request(app).get(`/accounts/${KNOWN_ACCOUNT_ID}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(KNOWN_ACCOUNT_ID);
    expect(res.body.data.sequence).toBe("1234567");
    expect(res.body.data.domain).toBe("example.com");
    expect(res.body.data.lastModified).toBe("2024-06-01T12:00:00Z");
  });

  it("includes displayName when off-chain display name is set", async () => {
    __setDisplayName(KNOWN_ACCOUNT_ID, "Alice");

    const res = await request(app).get(`/accounts/${KNOWN_ACCOUNT_ID}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe("Alice");
  });

  it("omits displayName when off-chain display name is not set", async () => {
    const res = await request(app).get(`/accounts/${KNOWN_ACCOUNT_ID}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("displayName");
  });

  it("omits domain when not present in on-chain data", async () => {
    const res = await request(app).get(`/accounts/${KNOWN_ACCOUNT_NO_DOMAIN}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(KNOWN_ACCOUNT_NO_DOMAIN);
    expect(res.body.data.sequence).toBe("8901234");
    expect(res.body.data).not.toHaveProperty("domain");
  });

  it("returns 400 for an invalid Stellar account ID format", async () => {
    const res = await request(app).get("/accounts/invalid-id/profile");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 404 for an unknown account", async () => {
    const unknownId = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const res = await request(app).get(`/accounts/${unknownId}/profile`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("returns only explicitly public fields (no internal data)", async () => {
    const res = await request(app).get(`/accounts/${KNOWN_ACCOUNT_ID}/profile`);

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.data);
    expect(keys).toEqual(expect.arrayContaining(["id", "sequence", "lastModified"]));
    expect(keys.every((k) =>
      ["id", "displayName", "domain", "sequence", "lastModified"].includes(k),
    )).toBe(true);
  });

  it("supports a custom-seeded account with partial on-chain data", async () => {
    const customId = "GC3O2R44KE7F6QK5XH5G5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X";
    __resetAccounts();
    __seedAccount({
      id: customId,
      sequence: "42",
      lastModified: "2025-01-10T16:00:00Z",
    });

    const res = await request(app).get(`/accounts/${customId}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(customId);
    expect(res.body.data.sequence).toBe("42");
    expect(res.body.data.lastModified).toBe("2025-01-10T16:00:00Z");
    expect(res.body.data).not.toHaveProperty("domain");
    expect(res.body.data).not.toHaveProperty("displayName");
  });

  it("combines on-chain and off-chain data together", async () => {
    const customId = "GC3O2R44KE7F6QK5XH5G5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X";
    __resetAccounts();
    __seedAccount({
      id: customId,
      sequence: "99",
      domain: "stellar.org",
      lastModified: "2025-03-20T09:00:00Z",
    });
    __setDisplayName(customId, "Bob");

    const res = await request(app).get(`/accounts/${customId}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(customId);
    expect(res.body.data.sequence).toBe("99");
    expect(res.body.data.domain).toBe("stellar.org");
    expect(res.body.data.displayName).toBe("Bob");
    expect(res.body.data.lastModified).toBe("2025-03-20T09:00:00Z");
  });
});
