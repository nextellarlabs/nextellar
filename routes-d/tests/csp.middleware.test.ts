import request from "supertest";
import express from "express";
import { createCspMiddleware } from "../middleware/csp.js";

describe("routes-d csp middleware", () => {
  it("sets strict default CSP", async () => {
    const app = express();
    app.use(createCspMiddleware());
    app.get("/html", (_req, res) => res.type("html").send("<h1>ok</h1>"));

    const res = await request(app).get("/html");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("supports per-route policy overrides", async () => {
    const app = express();
    app.use(createCspMiddleware({ overrides: { "/relaxed": { "default-src": ["'self'", "https://cdn.example.com"] } } }));
    app.get("/relaxed", (_req, res) => res.type("html").send("ok"));

    const res = await request(app).get("/relaxed");
    expect(res.headers["content-security-policy"]).toContain("https://cdn.example.com");
  });

  it("emits report-only header when configured", async () => {
    const app = express();
    app.use(createCspMiddleware({ reportOnly: true }));
    app.get("/report", (_req, res) => res.type("html").send("ok"));

    const res = await request(app).get("/report");
    expect(res.headers["content-security-policy-report-only"]).toBeDefined();
  });
});
