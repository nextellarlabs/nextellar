import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { GET } from "../routes/audit.js";
import { recordFailedAuth } from "../lib/auditLog.js";

describe("Audit endpoint integration", () => {
  beforeAll(() => {
    process.env.ROUTES_D_ADMIN_TOKEN = "test-admin-token-123";
  });

  afterAll(() => {
    delete process.env.ROUTES_D_ADMIN_TOKEN;
  });

  it("returns 403 without admin token", async () => {
    const req = new Request("http://localhost:3000/api/routes-d/audit");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 with wrong admin token", async () => {
    const req = new Request("http://localhost:3000/api/routes-d/audit", {
      headers: { "x-admin-token": "wrong-token" },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns audit entries with valid admin token", async () => {
    // Seed some data
    recordFailedAuth({
      ip: "192.168.1.100",
      identifier: "admin-test@example.com",
      identifierType: "email",
      reason: "Invalid credentials",
      route: "POST /api/auth/login",
    });

    const req = new Request("http://localhost:3000/api/routes-d/audit", {
      headers: { "x-admin-token": "test-admin-token-123" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entries).toBeDefined();
    expect(body.total).toBeGreaterThan(0);
  });

  it("returns summary with summary=true", async () => {
    const req = new Request(
      "http://localhost:3000/api/routes-d/audit?summary=true&hours=24",
      {
        headers: { "x-admin-token": "test-admin-token-123" },
      }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalAttempts).toBeDefined();
    expect(body.uniqueIdentifiers).toBeDefined();
    expect(body.topReasons).toBeDefined();
    expect(body.topIps).toBeDefined();
  });

  it("filters by date range", async () => {
    const req = new Request(
      "http://localhost:3000/api/routes-d/audit?startDate=2026-01-01&endDate=2026-12-31",
      {
        headers: { "x-admin-token": "test-admin-token-123" },
      }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});