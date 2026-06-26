import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import anchorFeesRouter, {
  __resetFeeCache,
  __resetAnchorRegistry,
  __seedAnchor,
  __seedFeeCache,
} from "../routes/anchors.fees.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(anchorFeesRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /anchors/:id/fees", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetFeeCache();
  });

  it("returns 200 with the fee schedule for a known anchor", async () => {
    const res = await request(app).get("/anchors/anchor-circle/fees");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.anchorId).toBe("anchor-circle");
    expect(res.body.data.name).toBe("Circle");
    expect(Array.isArray(res.body.data.fees)).toBe(true);
    expect(res.body.data.fees.length).toBeGreaterThan(0);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns fees with expected shape per entry", async () => {
    const res = await request(app).get("/anchors/anchor-circle/fees");

    expect(res.status).toBe(200);
    res.body.data.fees.forEach((fee: Record<string, unknown>) => {
      expect(fee).toHaveProperty("operation");
      expect(["deposit", "withdrawal"]).toContain(fee.operation);
      expect(fee).toHaveProperty("asset");
      expect(fee).toHaveProperty("fixed");
      expect(fee).toHaveProperty("percent");
    });
  });

  it("returns sep24Supported flag in response", async () => {
    const res = await request(app).get("/anchors/anchor-circle/fees");

    expect(res.status).toBe(200);
    expect(typeof res.body.data.sep24Supported).toBe("boolean");
    expect(res.body.data.sep24Supported).toBe(true);
  });

  it("returns 404 FEES_NOT_AVAILABLE when anchor has no fees (sep24 not configured)", async () => {
    const res = await request(app).get("/anchors/anchor-no-fees/fees");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FEES_NOT_AVAILABLE");
  });

  it("returns 404 ANCHOR_NOT_FOUND for an unknown anchor", async () => {
    const res = await request(app).get("/anchors/anchor-unknown-xyz/fees");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ANCHOR_NOT_FOUND");
  });

  it("returns fromCache: true on a second identical request within TTL window", async () => {
    await request(app).get("/anchors/anchor-circle/fees");
    const res = await request(app).get("/anchors/anchor-circle/fees");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns seeded cache entry as a cache hit", async () => {
    const seedData = {
      anchorId: "anchor-circle",
      name: "Circle",
      fees: [{ operation: "deposit" as const, asset: "USDC", fixed: "0.00", percent: "0.10" }],
      sep24Supported: true,
      fromCache: false,
    };
    __seedFeeCache("anchor-circle", seedData);

    const res = await request(app).get("/anchors/anchor-circle/fees");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.name).toBe("Circle");
  });

  it("returns fees for stronghold anchor", async () => {
    const res = await request(app).get("/anchors/anchor-stronghold/fees");

    expect(res.status).toBe(200);
    expect(res.body.data.anchorId).toBe("anchor-stronghold");
    expect(res.body.data.fees.length).toBeGreaterThan(0);
  });

  it("returns 200 with a dynamically seeded anchor", async () => {
    __resetAnchorRegistry();
    __seedAnchor("anchor-custom", {
      name: "CustomAnchor",
      sep24Supported: true,
      fees: [{ operation: "deposit", asset: "XLM", fixed: "0.00", percent: "0.15" }],
    });

    const res = await request(app).get("/anchors/anchor-custom/fees");

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("CustomAnchor");
    expect(res.body.data.fees[0].asset).toBe("XLM");
  });

  it("response data has the expected top-level shape", async () => {
    const res = await request(app).get("/anchors/anchor-circle/fees");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("anchorId");
    expect(res.body.data).toHaveProperty("name");
    expect(res.body.data).toHaveProperty("fees");
    expect(res.body.data).toHaveProperty("sep24Supported");
    expect(res.body.data).toHaveProperty("fromCache");
  });
});
