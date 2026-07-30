import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import anchorsAssetsRouter, {
  __resetAnchorsAssets,
  __seedAnchor,
} from "../routes/anchors.assets.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(anchorsAssetsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /anchors/:id/assets", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetAnchorsAssets();
  });

  it("returns 404 for an unknown anchor", async () => {
    const res = await request(app).get("/anchors/unknown-anchor/assets");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ANCHOR_NOT_FOUND");
  });

  it("returns all assets with min and max amounts for a known anchor", async () => {
    __seedAnchor("anchor-1", {
      id: "anchor-1",
      name: "Test Anchor",
      assets: [
        {
          code: "USDC",
          issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          minAmount: "10.00",
          maxAmount: "50000.00",
          depositEnabled: true,
          withdrawEnabled: true,
        },
      ],
    });

    const res = await request(app).get("/anchors/anchor-1/assets");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].code).toBe("USDC");
    expect(res.body.data[0].minAmount).toBe("10.00");
    expect(res.body.data[0].maxAmount).toBe("50000.00");
    expect(res.body.fromCache).toBe(false);
  });

  it("returns null for minAmount and maxAmount when the anchor provides partial info", async () => {
    __seedAnchor("anchor-2", {
      id: "anchor-2",
      name: "Partial Anchor",
      assets: [
        {
          code: "XLM",
          issuer: "native",
          depositEnabled: true,
          withdrawEnabled: false,
        },
      ],
    });

    const res = await request(app).get("/anchors/anchor-2/assets");
    expect(res.status).toBe(200);
    expect(res.body.data[0].minAmount).toBeNull();
    expect(res.body.data[0].maxAmount).toBeNull();
    expect(res.body.data[0].depositEnabled).toBe(true);
    expect(res.body.data[0].withdrawEnabled).toBe(false);
  });
});
