import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import assetsTopRouter from "../routes/assets.top.js";
import {
  __resetTrades,
  __seedTrade,
} from "../lib/volumeRollup.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(assetsTopRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-top-1";
const NOW = Date.now();

describe("GET /assets/top", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTrades();
  });

  describe("authentication", () => {
    it("returns 401 when x-user-id header is missing", async () => {
      const res = await request(app).get("/assets/top");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("window parameter validation", () => {
    it("defaults to 24h window when not specified", async () => {
      __seedTrade({
        id: "t1",
        asset: "XLM",
        amount: 100,
        price: 1,
        timestamp: new Date(NOW),
      });

      const res = await request(app)
        .get("/assets/top")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.window).toBe("24h");
      expect(res.body.data.assets).toHaveLength(1);
    });

    it("returns 400 for invalid window parameter", async () => {
      const res = await request(app)
        .get("/assets/top?window=invalid")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_WINDOW");
    });

    it("accepts 24h window", async () => {
      __seedTrade({
        id: "t1",
        asset: "XLM",
        amount: 100,
        price: 1,
        timestamp: new Date(NOW),
      });

      const res = await request(app)
        .get("/assets/top?window=24h")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.window).toBe("24h");
    });

    it("accepts 7d window", async () => {
      const res = await request(app)
        .get("/assets/top?window=7d")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.window).toBe("7d");
    });

    it("accepts 30d window", async () => {
      const res = await request(app)
        .get("/assets/top?window=30d")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.window).toBe("30d");
    });
  });

  describe("response shape", () => {
    it("returns top assets ranked by volume", async () => {
      __seedTrade({
        id: "t1",
        asset: "XLM",
        amount: 200,
        price: 1,
        timestamp: new Date(NOW),
      });
      __seedTrade({
        id: "t2",
        asset: "USDC",
        amount: 50,
        price: 1,
        timestamp: new Date(NOW),
      });

      const res = await request(app)
        .get("/assets/top")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assets).toHaveLength(2);
      expect(res.body.data.assets[0].asset).toBe("XLM");
      expect(res.body.data.assets[0].volume).toBe(200);
      expect(res.body.data.assets[0].tradeCount).toBe(1);
      expect(res.body.data.assets[0].lastPrice).toBe(1);
    });

    it("includes generatedAt timestamp", async () => {
      const res = await request(app)
        .get("/assets/top")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.generatedAt).toBeDefined();
      expect(new Date(res.body.data.generatedAt).toISOString()).toBe(
        res.body.data.generatedAt,
      );
    });

    it("returns empty assets array when no trades exist", async () => {
      const res = await request(app)
        .get("/assets/top")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.assets).toEqual([]);
    });
  });
});
