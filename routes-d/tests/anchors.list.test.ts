import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import anchorsListRouter, {
  __resetAnchorList,
  __seedAnchorList,
} from "../routes/anchors.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(anchorsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const mockAnchors = [
  {
    id: "anchor-circle",
    name: "Circle",
    homeDomain: "circle.com",
    supportedFlow: "both" as const,
    region: "global",
    assets: ["USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-vibrant",
    name: "Vibrant",
    homeDomain: "vibrantapp.com",
    supportedFlow: "deposit" as const,
    region: "latam",
    assets: ["USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-cowrie",
    name: "Cowrie",
    homeDomain: "cowrie.exchange",
    supportedFlow: "both" as const,
    region: "africa",
    assets: ["NGN", "USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-withdrawal-only",
    name: "WithdrawCo",
    homeDomain: "withdrawco.io",
    supportedFlow: "withdrawal" as const,
    region: "eu",
    assets: ["EURC"],
    sep24Supported: false,
  },
];

describe("GET /anchors", () => {
  const app = buildApp();

  beforeEach(() => {
    __seedAnchorList(mockAnchors);
  });

  afterEach(() => {
    __resetAnchorList();
  });

  it("returns 200 with the full list when no filters are applied", async () => {
    const res = await request(app).get("/anchors");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(4);
    expect(typeof res.body.total).toBe("number");
  });

  it("returns total count matching the data array length", async () => {
    const res = await request(app).get("/anchors");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.data.length);
  });

  it("filters by flow=deposit and includes anchors that support both", async () => {
    const res = await request(app).get("/anchors?flow=deposit");

    expect(res.status).toBe(200);
    // circle (both), vibrant (deposit), cowrie (both) — not withdrawal-only
    expect(res.body.data.length).toBe(3);
    res.body.data.forEach((a: { supportedFlow: string }) => {
      expect(["deposit", "both"]).toContain(a.supportedFlow);
    });
  });

  it("filters by flow=withdrawal and includes anchors that support both", async () => {
    const res = await request(app).get("/anchors?flow=withdrawal");

    expect(res.status).toBe(200);
    // circle (both), cowrie (both), withdrawal-only — not vibrant (deposit only)
    expect(res.body.data.length).toBe(3);
  });

  it("filters by flow=both returns only anchors with supportedFlow=both", async () => {
    const res = await request(app).get("/anchors?flow=both");

    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { supportedFlow: string }) => a.supportedFlow === "both")).toBe(true);
  });

  it("filters by region=latam and includes global anchors", async () => {
    const res = await request(app).get("/anchors?region=latam");

    expect(res.status).toBe(200);
    // circle (global) + vibrant (latam)
    expect(res.body.data.length).toBe(2);
    res.body.data.forEach((a: { region: string }) => {
      expect(["latam", "global"]).toContain(a.region);
    });
  });

  it("filters by region=africa returns region-specific and global anchors", async () => {
    const res = await request(app).get("/anchors?region=africa");

    expect(res.status).toBe(200);
    // circle (global) + cowrie (africa)
    expect(res.body.data.length).toBe(2);
  });

  it("combines flow and region filters correctly", async () => {
    const res = await request(app).get("/anchors?flow=withdrawal&region=africa");

    expect(res.status).toBe(200);
    // cowrie (both, africa) + circle (both, global)
    expect(res.body.data.length).toBe(2);
  });

  it("returns 400 INVALID_FLOW_FILTER for an unrecognised flow value", async () => {
    const res = await request(app).get("/anchors?flow=unknown");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FLOW_FILTER");
  });

  it("returns 400 INVALID_REGION_FILTER for an unrecognised region value", async () => {
    const res = await request(app).get("/anchors?region=mars");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REGION_FILTER");
  });

  it("returns an empty list when no anchors match the filter", async () => {
    __seedAnchorList([]);
    const res = await request(app).get("/anchors");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("each anchor has the expected shape", async () => {
    const res = await request(app).get("/anchors");

    expect(res.status).toBe(200);
    res.body.data.forEach((a: Record<string, unknown>) => {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("name");
      expect(a).toHaveProperty("homeDomain");
      expect(a).toHaveProperty("supportedFlow");
      expect(a).toHaveProperty("region");
      expect(a).toHaveProperty("assets");
      expect(a).toHaveProperty("sep24Supported");
    });
  });
});
