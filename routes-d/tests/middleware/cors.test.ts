import express from "express";
import request from "supertest";
import corsMiddleware from "../../middleware/cors.js";

const ORIGINAL_ENV = process.env;

function buildApp() {
  const app = express();
  app.use(corsMiddleware);
  app.get("/ping", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("routes-d corsMiddleware", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      ALLOWED_ORIGINS:
        "https://app.nextellar.dev,https://admin.nextellar.dev",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── Allowed origins ────────────────────────────────────────────────────────

  it("allows an explicitly allowlisted origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://app.nextellar.dev");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.nextellar.dev",
    );
  });

  it("allows the second allowlisted origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://admin.nextellar.dev");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://admin.nextellar.dev",
    );
  });

  // ── Credentialed requests ──────────────────────────────────────────────────

  it("sets Access-Control-Allow-Credentials: true for allowlisted origins", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://app.nextellar.dev");

    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("sets Vary: Origin to prevent cache poisoning", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://app.nextellar.dev");

    expect(res.headers["vary"]).toMatch(/Origin/i);
  });

  // ── Disallowed origins ─────────────────────────────────────────────────────

  it("rejects an unlisted origin with 403", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://evil.example.com");

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Origin not allowed");
  });

  it("does NOT echo the disallowed origin in response headers", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://evil.example.com");

    // The disallowed origin must never appear as ACAO — prevents leaking it.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does NOT set credentials header for a disallowed origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://evil.example.com");

    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  // ── No Origin header ──────────────────────────────────────────────────────

  it("passes through requests with no Origin header", async () => {
    const app = buildApp();
    const res = await request(app).get("/ping");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // ── CORS preflight ────────────────────────────────────────────────────────

  it("handles OPTIONS preflight for an allowed origin with 204", async () => {
    const app = buildApp();
    const res = await request(app)
      .options("/ping")
      .set("Origin", "https://app.nextellar.dev")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("rejects OPTIONS preflight from a disallowed origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .options("/ping")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(403);
  });

  // ── Empty allowlist ───────────────────────────────────────────────────────

  it("rejects all origins when ALLOWED_ORIGINS is empty", async () => {
    process.env.ALLOWED_ORIGINS = "";
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set("Origin", "https://app.nextellar.dev");

    expect(res.status).toBe(403);
  });
});
