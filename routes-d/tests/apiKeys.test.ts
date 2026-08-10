import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  ApiKey,
  __seedApiKey,
  __resetApiKeys,
  __getApiKeys,
  __generateRawKey,
  __hashKey,
} from "../routes/apiKeys.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-123";
const OTHER_USER = "user-999";

function makeSeedKey(overrides: Partial<ApiKey> = {}): ApiKey {
  const raw = __generateRawKey();
  return {
    id: "ak_test001",
    userId: USER_ID,
    prefix: raw.slice(0, 7),
    hashedKey: __hashKey(raw),
    label: "Test key",
    scopes: ["read", "write"],
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    rotatedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("POST /api-keys (create)", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetApiKeys();
  });

  it("creates a new API key and returns the raw key", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({ userId: USER_ID, label: "My key", scopes: ["read"] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rawKey).toMatch(/^nx_[a-f0-9]{64}$/);
    expect(res.body.data.label).toBe("My key");
    expect(res.body.data.scopes).toEqual(["read"]);
    expect(res.body.data.hashedKey).toBeUndefined();
    expect(res.body.data.id).toBeDefined();
  });

  it("stores the hashed key, not the raw key", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({ userId: USER_ID });

    const stored = __getApiKeys().get(res.body.data.id);
    expect(stored).toBeDefined();
    expect(stored!.hashedKey).not.toBe(res.body.data.rawKey);
    expect(stored!.hashedKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sets expiry when expiresInDays is provided", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({ userId: USER_ID, expiresInDays: 30 });

    expect(res.status).toBe(201);
    expect(res.body.data.expiresAt).toBeDefined();
    const expiry = new Date(res.body.data.expiresAt);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it("defaults label to 'Unnamed key' when not provided", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({ userId: USER_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.label).toBe("Unnamed key");
  });

  it("returns 401 when userId is not provided", async () => {
    const res = await request(app).post("/api-keys").send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("accepts userId from x-user-id header", async () => {
    const res = await request(app)
      .post("/api-keys")
      .set("x-user-id", USER_ID)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(USER_ID);
  });
});

describe("GET /api-keys (list)", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetApiKeys();
  });

  it("returns empty list when user has no keys", async () => {
    const res = await request(app)
      .get("/api-keys")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("returns only keys belonging to the calling user", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-1", userId: USER_ID }));
    __seedApiKey(makeSeedKey({ id: "ak-2", userId: USER_ID }));
    __seedApiKey(makeSeedKey({ id: "ak-3", userId: OTHER_USER }));

    const res = await request(app)
      .get("/api-keys")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const ids = res.body.data.map((k: { id: string }) => k.id);
    expect(ids).toContain("ak-1");
    expect(ids).toContain("ak-2");
    expect(ids).not.toContain("ak-3");
  });

  it("excludes revoked keys by default", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-active" }));
    __seedApiKey(
      makeSeedKey({
        id: "ak-revoked",
        revokedAt: "2024-06-01T00:00:00Z",
      }),
    );

    const res = await request(app)
      .get("/api-keys")
      .send({ userId: USER_ID });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("ak-active");
  });

  it("includes revoked keys when ?includeAll=true", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-active" }));
    __seedApiKey(
      makeSeedKey({
        id: "ak-revoked",
        revokedAt: "2024-06-01T00:00:00Z",
      }),
    );

    const res = await request(app)
      .get("/api-keys?includeAll=true")
      .send({ userId: USER_ID });

    expect(res.body.data).toHaveLength(2);
  });

  it("never exposes the hashedKey", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-1" }));

    const res = await request(app)
      .get("/api-keys")
      .send({ userId: USER_ID });

    expect(res.body.data[0].hashedKey).toBeUndefined();
  });

  it("returns 401 when userId is not provided", async () => {
    const res = await request(app).get("/api-keys").send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api-keys/:id/rotate", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetApiKeys();
  });

  it("rotates a key and returns a new raw key", async () => {
    const seed = makeSeedKey({ id: "ak-rotate" });
    __seedApiKey(seed);

    const res = await request(app)
      .post("/api-keys/ak-rotate/rotate")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rawKey).toMatch(/^nx_[a-f0-9]{64}$/);
    expect(res.body.data.rotatedAt).toBeDefined();
    expect(res.body.data.hashedKey).toBeUndefined();
  });

  it("updates the stored hash to match the new key", async () => {
    const seed = makeSeedKey({ id: "ak-rotate2" });
    __seedApiKey(seed);

    const res = await request(app)
      .post("/api-keys/ak-rotate2/rotate")
      .send({ userId: USER_ID });

    const stored = __getApiKeys().get("ak-rotate2");
    expect(stored!.hashedKey).toBe(__hashKey(res.body.data.rawKey));
  });

  it("preserves label, scopes, and userId after rotation", async () => {
    const seed = makeSeedKey({
      id: "ak-rotate3",
      label: "My key",
      scopes: ["admin"],
    });
    __seedApiKey(seed);

    const res = await request(app)
      .post("/api-keys/ak-rotate3/rotate")
      .send({ userId: USER_ID });

    expect(res.body.data.label).toBe("My key");
    expect(res.body.data.scopes).toEqual(["admin"]);
    expect(res.body.data.userId).toBe(USER_ID);
  });

  it("returns 404 for nonexistent key", async () => {
    const res = await request(app)
      .post("/api-keys/ak-nonexistent/rotate")
      .send({ userId: USER_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("API_KEY_NOT_FOUND");
  });

  it("returns 403 when user does not own the key", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-own" }));

    const res = await request(app)
      .post("/api-keys/ak-own/rotate")
      .send({ userId: OTHER_USER });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 when key is already revoked", async () => {
    __seedApiKey(
      makeSeedKey({
        id: "ak-rev",
        revokedAt: "2024-06-01T00:00:00Z",
      }),
    );

    const res = await request(app)
      .post("/api-keys/ak-rev/rotate")
      .send({ userId: USER_ID });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KEY_ALREADY_REVOKED");
  });

  it("returns 401 when userId is not provided", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-auth" }));

    const res = await request(app).post("/api-keys/ak-auth/rotate").send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api-keys/:id/revoke", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetApiKeys();
  });

  it("revokes an active key", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-revoke" }));

    const res = await request(app)
      .post("/api-keys/ak-revoke/revoke")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.revokedAt).toBeDefined();

    const stored = __getApiKeys().get("ak-revoke");
    expect(stored!.revokedAt).not.toBeNull();
  });

  it("returns 404 for nonexistent key", async () => {
    const res = await request(app)
      .post("/api-keys/ak-ghost/revoke")
      .send({ userId: USER_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("API_KEY_NOT_FOUND");
  });

  it("returns 403 when user does not own the key", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-owner" }));

    const res = await request(app)
      .post("/api-keys/ak-owner/revoke")
      .send({ userId: OTHER_USER });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 when key is already revoked", async () => {
    __seedApiKey(
      makeSeedKey({
        id: "ak-dbl",
        revokedAt: "2024-06-01T00:00:00Z",
      }),
    );

    const res = await request(app)
      .post("/api-keys/ak-dbl/revoke")
      .send({ userId: USER_ID });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KEY_ALREADY_REVOKED");
  });

  it("returns 401 when userId is not provided", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-auth2" }));

    const res = await request(app)
      .post("/api-keys/ak-auth2/revoke")
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("scope enforcement", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetApiKeys();
  });

  it("stores and returns per-key scopes on create", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({
        userId: USER_ID,
        scopes: ["read", "write", "admin"],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.scopes).toEqual(["read", "write", "admin"]);
  });

  it("defaults to empty scopes array when none provided", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({ userId: USER_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.scopes).toEqual([]);
  });

  it("filters out empty string scopes", async () => {
    const res = await request(app)
      .post("/api-keys")
      .send({
        userId: USER_ID,
        scopes: ["read", "", "  ", "write"],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.scopes).toEqual(["read", "write"]);
  });

  it("preserves scopes through rotation", async () => {
    __seedApiKey(
      makeSeedKey({
        id: "ak-scopes",
        scopes: ["payments:read"],
      }),
    );

    const res = await request(app)
      .post("/api-keys/ak-scopes/rotate")
      .send({ userId: USER_ID });

    expect(res.body.data.scopes).toEqual(["payments:read"]);
  });

  it("revoked key no longer appears in default listing", async () => {
    __seedApiKey(makeSeedKey({ id: "ak-live", scopes: ["read"] }));

    await request(app)
      .post("/api-keys/ak-live/revoke")
      .send({ userId: USER_ID });

    const res = await request(app)
      .get("/api-keys")
      .send({ userId: USER_ID });

    expect(res.body.data).toHaveLength(0);
  });
});
