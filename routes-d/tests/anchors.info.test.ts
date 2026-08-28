import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import anchorsInfoRouter, {
  __resetAnchorCache,
  __seedAnchorCache,
  __registerAnchor,
  __removeAnchor,
} from "../routes/anchors.info.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(anchorsInfoRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /anchors/:id/info", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAnchorCache();
  });

  it("returns 200 with metadata for a known anchor", async () => {
    const res = await request(app).get("/anchors/stellar-anchor/info");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.anchorId).toBe("stellar-anchor");
    expect(res.body.data.name).toBe("Stellar Anchor");
    expect(Array.isArray(res.body.data.currencies)).toBe(true);
  });

  it("returns 200 with another known anchor", async () => {
    const res = await request(app).get("/anchors/circle-anchor/info");

    expect(res.status).toBe(200);
    expect(res.body.data.anchorId).toBe("circle-anchor");
    expect(res.body.data.currencies).toContain("USDC");
  });

  it("returns 404 ANCHOR_NOT_FOUND for an unknown anchor id", async () => {
    const res = await request(app).get("/anchors/unknown-anchor-xyz/info");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ANCHOR_NOT_FOUND");
  });

  it("returns 400 INVALID_ANCHOR_ID for an id that is too short", async () => {
    const res = await request(app).get("/anchors/ab/info");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ANCHOR_ID");
  });

  it("returns 400 INVALID_ANCHOR_ID when id contains uppercase letters", async () => {
    const res = await request(app).get("/anchors/STELLAR-ANCHOR/info");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ANCHOR_ID");
  });

  it("returns 400 INVALID_ANCHOR_ID when id contains invalid characters", async () => {
    const res = await request(app).get("/anchors/anchor_invalid!/info");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ANCHOR_ID");
  });

  it("returns fromCache: false on the first fetch", async () => {
    const res = await request(app).get("/anchors/stellar-anchor/info");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns fromCache: true on a second call within the TTL window", async () => {
    await request(app).get("/anchors/stellar-anchor/info");
    const res = await request(app).get("/anchors/stellar-anchor/info");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns cached entry when TTL has not expired (stale TTL test)", async () => {
    const customMeta = {
      anchorId: "test-anchor",
      name: "Test Anchor",
      description: "Cached version",
      homepage: "https://test.example.com",
      supportEmail: "test@example.com",
      currencies: ["TEST"],
      sep10Enabled: true,
      sep24Enabled: false,
      sep31Enabled: false,
    };

    __registerAnchor("test-anchor", { ...customMeta, name: "Live Version" });
    __seedAnchorCache("test-anchor", customMeta, Date.now());

    const res = await request(app).get("/anchors/test-anchor/info");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.name).toBe("Test Anchor");
  });

  it("re-fetches when cached entry TTL has expired", async () => {
    const liveMeta = {
      anchorId: "test-anchor",
      name: "Live Anchor",
      description: "Live version",
      homepage: "https://test.example.com",
      supportEmail: "test@example.com",
      currencies: ["LIVE"],
      sep10Enabled: true,
      sep24Enabled: true,
      sep31Enabled: false,
    };
    __registerAnchor("test-anchor", liveMeta);

    const expiredFetchedAt = Date.now() - 60_000;
    __seedAnchorCache(
      "test-anchor",
      { ...liveMeta, name: "Expired Stale Name" },
      expiredFetchedAt,
    );

    const res = await request(app).get("/anchors/test-anchor/info");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(false);
    expect(res.body.data.name).toBe("Live Anchor");

    __removeAnchor("test-anchor");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app).get("/anchors/circle-anchor/info");

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty("anchorId");
    expect(data).toHaveProperty("name");
    expect(data).toHaveProperty("description");
    expect(data).toHaveProperty("homepage");
    expect(data).toHaveProperty("supportEmail");
    expect(data).toHaveProperty("currencies");
    expect(data).toHaveProperty("sep10Enabled");
    expect(data).toHaveProperty("sep24Enabled");
    expect(data).toHaveProperty("sep31Enabled");
    expect(data).toHaveProperty("fromCache");
  });
});
