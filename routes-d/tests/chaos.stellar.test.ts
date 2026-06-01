import express, { type Express } from "express";
import request from "supertest";
import { CircuitBreaker, CircuitOpenError } from "../lib/circuitBreaker.js";
import {
  createResilientHorizonClient,
  createResilientSorobanRpc,
  type HorizonFailoverEvent,
} from "../lib/resilientStellar.js";
import type { HorizonFetcher } from "../lib/horizonClient.js";
import { createSorobanHealthRouter } from "../routes/health.soroban.js";

function makeFetcher(
  handlers: Record<string, () => Promise<{ ok: boolean; status: number; body: unknown; delayMs?: number }>>,
): HorizonFetcher {
  return async (url) => {
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected url ${url}`);
    const result = await handlers[key]!();
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }
    return {
      ok: result.ok,
      status: result.status,
      json: async () => result.body,
    };
  };
}

describe("routes-d stellar chaos resilience", () => {
  const PRIMARY = "https://horizon.primary.test";
  const FALLBACK = "https://horizon.fallback.test";
  let rejections: unknown[] = [];

  beforeEach(() => {
    rejections = [];
    process.on("unhandledRejection", onRejection);
  });

  afterEach(() => {
    process.off("unhandledRejection", onRejection);
  });

  function onRejection(reason: unknown) {
    rejections.push(reason);
  }

  it("opens the circuit after repeated 5xx responses and recovers after reset", async () => {
    let mode: "fail" | "ok" = "fail";
    const fetcher: HorizonFetcher = async (url) => {
      if (!url.includes(PRIMARY)) throw new Error(`unexpected url ${url}`);
      if (mode === "ok") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    };

    const client = createResilientHorizonClient({
      primaryUrl: PRIMARY,
      fetcher,
      timeoutMs: 50,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30 },
    });

    await expect(client.getJson("/accounts/GABC")).rejects.toThrow(/HTTP 503/);
    await expect(client.getJson("/accounts/GABC")).rejects.toThrow(/HTTP 503/);
    await expect(client.getJson("/accounts/GABC")).rejects.toBeInstanceOf(CircuitOpenError);
    expect(client.circuitState()).toBe("open");

    await new Promise((resolve) => setTimeout(resolve, 35));
    mode = "ok";
    await expect(client.getJson("/accounts/GABC")).resolves.toEqual({ ok: true });
    expect(client.circuitState()).toBe("closed");
    expect(rejections).toHaveLength(0);
  });

  it("fails over from primary to fallback when primary DNS fails", async () => {
    const events: HorizonFailoverEvent[] = [];
    const fetcher = makeFetcher({
      [PRIMARY]: async () => {
        throw new Error("ENOTFOUND horizon.primary.test");
      },
      [FALLBACK]: async () => ({ ok: true, status: 200, body: { source: "fallback" } }),
    });

    const client = createResilientHorizonClient({
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      fetcher,
      timeoutMs: 100,
      onFailover: (event) => events.push(event),
      circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 1_000 },
    });

    const body = await client.getJson<{ source: string }>("/ledgers?limit=1");
    expect(body.source).toBe("fallback");
    expect(client.lastEndpointUsed()).toBe("fallback");
    expect(events).toHaveLength(1);
    expect(rejections).toHaveLength(0);
  });

  it("treats slow primary responses as failures without unhandled rejections", async () => {
    const fetcher = makeFetcher({
      [PRIMARY]: async () => ({
        ok: true,
        status: 200,
        body: { late: true },
        delayMs: 200,
      }),
      [FALLBACK]: async () => ({ ok: true, status: 200, body: { source: "fallback" } }),
    });

    const client = createResilientHorizonClient({
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      fetcher,
      timeoutMs: 30,
      circuitBreaker: { failureThreshold: 10, resetTimeoutMs: 1_000 },
    });

    const body = await client.getJson<{ source?: string; late?: boolean }>("/accounts/GABC");
    expect(body.source ?? body.late).toBeTruthy();
    expect(rejections).toHaveLength(0);
  });

  it("degrades Soroban health checks when RPC calls fail repeatedly", async () => {
    let failures = 0;
    const rpc = createResilientSorobanRpc(
      {
        async getLatestLedger() {
          failures += 1;
          throw new Error("RPC 503 storm");
        },
      },
      { failureThreshold: 2, resetTimeoutMs: 50 },
    );

    const app: Express = express();
    app.use("/health", createSorobanHealthRouter({ rpc, sleep: async () => {} }));

    const first = await request(app).get("/health/soroban");
    expect(first.status).toBe(503);
    expect(first.body.status).toBe("unreachable");

    const second = await request(app).get("/health/soroban");
    expect(second.status).toBe(503);
    expect(rpc.circuitState()).toBe("open");
    expect(rejections).toHaveLength(0);
    expect(failures).toBeGreaterThanOrEqual(2);
  });

  it("circuit breaker isolates bursts without leaking rejections", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10 });
    await expect(
      breaker.execute(async () => {
        throw new Error("storm");
      }),
    ).rejects.toThrow("storm");
    await expect(
      breaker.execute(async () => "ok"),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(rejections).toHaveLength(0);
  });
});
