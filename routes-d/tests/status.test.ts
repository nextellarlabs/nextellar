// Tests for the overall status endpoint (#332). Covers all-healthy,
// one-degraded, all-down, and the per-check timeout escape hatch.

import express, { type Express } from "express";
import request from "supertest";
import {
  _rollUp,
  createStatusRouter,
  type StatusCheck,
} from "../routes/status.js";

function buildApp(checks: StatusCheck[], opts: { timeoutMs?: number; now?: () => number } = {}): Express {
  const app = express();
  app.use("/status", createStatusRouter({ checks, ...opts }));
  return app;
}

describe("_rollUp (pure function)", () => {
  it("returns healthy when every component is healthy", () => {
    expect(
      _rollUp([
        { name: "a", state: "healthy", latencyMs: 1 },
        { name: "b", state: "healthy", latencyMs: 2 },
      ]),
    ).toBe("healthy");
  });

  it("returns unreachable if any component is unreachable", () => {
    expect(
      _rollUp([
        { name: "a", state: "healthy", latencyMs: 1 },
        { name: "b", state: "unreachable", latencyMs: 1 },
      ]),
    ).toBe("unreachable");
  });

  it("returns degraded if all components are reachable but any is degraded", () => {
    expect(
      _rollUp([
        { name: "a", state: "healthy", latencyMs: 1 },
        { name: "b", state: "degraded", latencyMs: 2 },
      ]),
    ).toBe("degraded");
  });

  it("returns healthy when there are no components (empty check set)", () => {
    expect(_rollUp([])).toBe("healthy");
  });
});

describe("GET /status", () => {
  it("returns 200 + healthy when every fan-out reports healthy", async () => {
    const app = buildApp([
      { name: "horizon", check: async () => ({ state: "healthy", detail: { latestLedger: 1 } }) },
      { name: "soroban", check: async () => ({ state: "healthy" }) },
    ]);
    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.components).toHaveLength(2);
    expect(res.body.components[0]).toMatchObject({
      name: "horizon",
      state: "healthy",
      detail: { latestLedger: 1 },
    });
  });

  it("returns 503 + degraded when one component is degraded", async () => {
    const app = buildApp([
      { name: "horizon", check: async () => ({ state: "healthy" }) },
      { name: "cache", check: async () => ({ state: "degraded", error: "high latency" }) },
    ]);
    const res = await request(app).get("/status");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.components[1].error).toBe("high latency");
  });

  it("returns 503 + unreachable when all components are unreachable", async () => {
    const app = buildApp([
      { name: "horizon", check: async () => ({ state: "unreachable", error: "ENOTFOUND" }) },
      { name: "soroban", check: async () => ({ state: "unreachable", error: "timeout" }) },
    ]);
    const res = await request(app).get("/status");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unreachable");
  });

  it("returns 503 + unreachable when a fan-out throws (defensive catch)", async () => {
    const app = buildApp([
      {
        name: "boom",
        check: async () => {
          throw new Error("kaboom");
        },
      },
    ]);
    const res = await request(app).get("/status");
    expect(res.status).toBe(503);
    expect(res.body.components[0]).toMatchObject({
      name: "boom",
      state: "unreachable",
      error: "kaboom",
    });
  });

  it("times out an individual slow check without wedging the response", async () => {
    const app = buildApp(
      [
        {
          name: "slow",
          check: () =>
            new Promise((resolve) => {
              // Resolves long after the timeout — race timeout wins.
              setTimeout(() => resolve({ state: "healthy" }), 100);
            }),
        },
      ],
      { timeoutMs: 10 },
    );
    const res = await request(app).get("/status");
    expect(res.status).toBe(503);
    expect(res.body.components[0].state).toBe("unreachable");
    expect(res.body.components[0].error).toMatch(/timed out/);
  });

  it("records latency for every component using the injected clock", async () => {
    let t = 1000;
    const app = buildApp(
      [{ name: "horizon", check: async () => ({ state: "healthy" }) }],
      {
        now: () => {
          const v = t;
          t += 25;
          return v;
        },
      },
    );
    const res = await request(app).get("/status");
    expect(res.body.components[0].latencyMs).toBe(25);
  });
});
