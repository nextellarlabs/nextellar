import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import yieldsRouter, {
  __resetYieldsCache,
  __setStrategies,
  __seedYieldsCache,
  __setFetchAvailable,
} from "../routes/defi.yields.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(yieldsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /defi/yields", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetYieldsCache();
  });

  it("returns 200 with an empty yields array when no strategies are registered", async () => {
    __setStrategies([]);

    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.yields).toEqual([]);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns yields ranked by netApy descending", async () => {
    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const yields = res.body.data.yields;
    expect(yields.length).toBeGreaterThan(1);

    for (let i = 0; i < yields.length - 1; i++) {
      expect(parseFloat(yields[i].netApy)).toBeGreaterThanOrEqual(parseFloat(yields[i + 1].netApy));
    }

    expect(yields[0].id).toBe("phoenix-btc-xlm");
  });

  it("returns fromCache: false on the first (fresh) fetch", async () => {
    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns fromCache: true on a second call within the TTL window", async () => {
    await request(app).get("/defi/yields");
    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns stale cached data with stale: true when fetch fails but cache exists", async () => {
    __seedYieldsCache([
      { id: "stale-strategy", name: "Stale Pool", protocol: "OldPro", asset: "XLM", grossApy: "3.00", feeRate: "0.10", netApy: "2.90" },
    ]);
    __setFetchAvailable(false);

    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.stale).toBe(true);
    expect(res.body.data.yields[0].id).toBe("stale-strategy");
  });

  it("returns 503 YIELDS_UNAVAILABLE when fetch fails and no cache exists", async () => {
    __setFetchAvailable(false);

    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("YIELDS_UNAVAILABLE");
  });

  it("each yield strategy has the expected shape", async () => {
    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    const strategy = res.body.data.yields[0];
    expect(strategy).toHaveProperty("id");
    expect(strategy).toHaveProperty("name");
    expect(strategy).toHaveProperty("protocol");
    expect(strategy).toHaveProperty("asset");
    expect(strategy).toHaveProperty("grossApy");
    expect(strategy).toHaveProperty("feeRate");
    expect(strategy).toHaveProperty("netApy");
  });

  it("does not include stale field on a successful fresh fetch", async () => {
    const res = await request(app).get("/defi/yields");

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("stale");
  });
});
