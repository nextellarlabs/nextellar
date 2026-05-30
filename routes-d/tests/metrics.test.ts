import express, { type Express } from "express";
import request from "supertest";
import metricsRouter from "../routes/metrics.js";
import { recordRequest, resetMetrics } from "../lib/metrics.js";

function buildApp(): Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(metricsRouter);
  return app;
}

describe("GET /metrics", () => {
  beforeEach(() => resetMetrics());

  it("returns Prometheus text for internal callers", async () => {
    recordRequest("/soroban/invoke", "POST", 200, 12);
    recordRequest("/soroban/invoke", "POST", 500, 50);
    const res = await request(buildApp())
      .get("/metrics")
      .set("X-Forwarded-For", "127.0.0.1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("nextellar_http_requests_total{route=\"/soroban/invoke\",method=\"POST\",status=\"200\"} 1");
    expect(res.text).toContain("nextellar_http_request_errors_total{route=\"/soroban/invoke\",method=\"POST\",status=\"500\"} 1");
    expect(res.text).toContain("nextellar_http_request_duration_ms_count{route=\"/soroban/invoke\",method=\"POST\",status=\"200\"} 1");
  });

  it("rejects external callers", async () => {
    const res = await request(buildApp()).get("/metrics").set("X-Forwarded-For", "8.8.8.8");
    expect(res.status).toBe(403);
  });
});
