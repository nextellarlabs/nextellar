import request from "supertest";
import express from "express";
import { createIpFilterMiddleware } from "../middleware/ipFilter.js";

describe("routes-d ip filter middleware", () => {
  const logs: Array<{ message: string; ip: string }> = [];

  function appFor(env: NodeJS.ProcessEnv) {
    const app = express();
    app.set("trust proxy", true);
    app.use(createIpFilterMiddleware({ env, logger: (event) => logs.push(event) }));
    app.get("/secure", (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it("allows matched allowlist IP", async () => {
    const app = appFor({ ROUTES_D_ALLOWLIST_CIDRS: "10.0.0.0/8", ROUTES_D_BLOCKLIST_CIDRS: "" });
    const res = await request(app).get("/secure").set("x-forwarded-for", "10.5.4.3");
    expect(res.status).toBe(200);
  });

  it("blocks matched blocklist IP", async () => {
    const app = appFor({ ROUTES_D_ALLOWLIST_CIDRS: "0.0.0.0/0", ROUTES_D_BLOCKLIST_CIDRS: "10.0.0.0/8" });
    const res = await request(app).get("/secure").set("x-forwarded-for", "10.5.4.3");
    expect(res.status).toBe(403);
  });

  it("blocklist takes precedence over allowlist when overlapping", async () => {
    const app = appFor({ ROUTES_D_ALLOWLIST_CIDRS: "10.0.0.0/8", ROUTES_D_BLOCKLIST_CIDRS: "10.5.0.0/16" });
    const res = await request(app).get("/secure").set("x-forwarded-for", "10.5.4.3");
    expect(res.status).toBe(403);
    expect(logs[logs.length - 1]?.ip).toBe("10.5.x.x");
  });
});
