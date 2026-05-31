import express from "express";
import request from "supertest";
import {
  secureHeaders,
  SECURE_HEADER_DEFAULTS,
} from "../../middleware/secureHeaders.js";

function buildApp() {
  const app = express();
  app.use(secureHeaders());
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("routes-d secureHeaders middleware", () => {
  // ── Default header presence ────────────────────────────────────────────────

  it("sets Strict-Transport-Security with correct max-age", async () => {
    const res = await request(buildApp()).get("/health");

    expect(res.headers["strict-transport-security"]).toBe(
      SECURE_HEADER_DEFAULTS["Strict-Transport-Security"],
    );
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(buildApp()).get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets Referrer-Policy", async () => {
    const res = await request(buildApp()).get("/health");

    expect(res.headers["referrer-policy"]).toBe(
      SECURE_HEADER_DEFAULTS["Referrer-Policy"],
    );
  });

  it("sets Permissions-Policy restricting sensitive APIs", async () => {
    const res = await request(buildApp()).get("/health");

    const pp = res.headers["permissions-policy"] as string;
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });

  it("sets all four default security headers in one request", async () => {
    const res = await request(buildApp()).get("/health");

    expect(res.status).toBe(200);
    for (const name of Object.keys(SECURE_HEADER_DEFAULTS)) {
      expect(res.headers[name.toLowerCase()]).toBeDefined();
    }
  });

  // ── Per-route opt-out ──────────────────────────────────────────────────────

  it("omits HSTS when opted out on a specific route", async () => {
    const app = express();
    app.get(
      "/internal",
      secureHeaders({ omit: ["Strict-Transport-Security"] }),
      (_req, res) => res.status(200).json({ ok: true }),
    );

    const res = await request(app).get("/internal");

    expect(res.headers["strict-transport-security"]).toBeUndefined();
    // Other headers are still present
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("omits multiple headers when listed in omit array", async () => {
    const app = express();
    app.get(
      "/legacy",
      secureHeaders({
        omit: ["Strict-Transport-Security", "Permissions-Policy"],
      }),
      (_req, res) => res.status(200).json({ ok: true }),
    );

    const res = await request(app).get("/legacy");

    expect(res.headers["strict-transport-security"]).toBeUndefined();
    expect(res.headers["permissions-policy"]).toBeUndefined();
    // Non-omitted headers still applied
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBeDefined();
  });

  it("applies all headers when omit is an empty array", async () => {
    const app = express();
    app.use(secureHeaders({ omit: [] }));
    app.get("/full", (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(app).get("/full");

    for (const name of Object.keys(SECURE_HEADER_DEFAULTS)) {
      expect(res.headers[name.toLowerCase()]).toBeDefined();
    }
  });

  // ── Does not break normal response flow ───────────────────────────────────

  it("does not alter the response status code", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
  });

  it("does not block POST requests", async () => {
    const app = express();
    app.use(express.json());
    app.use(secureHeaders());
    app.post("/data", (_req, res) => res.status(201).json({ created: true }));

    const res = await request(app).post("/data").send({ key: "value" });

    expect(res.status).toBe(201);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
