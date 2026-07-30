import express from "express";
import request from "supertest";
import corsMiddleware from "../../backend/middleware/cors";

const ORIGINAL_ENV = process.env;

function buildApp() {
  const app = express();
  app.use(corsMiddleware);
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("corsMiddleware", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      ALLOWED_ORIGINS: "https://app.nextellar.dev,https://admin.nextellar.dev",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("allows explicitly allowlisted origins and enables credentials", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/health")
      .set("Origin", "https://app.nextellar.dev");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.nextellar.dev",
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects unlisted origins with 403", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Origin not allowed");
  });
});
