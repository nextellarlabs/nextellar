import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import assetsSearchRouter from "../routes/assets.search.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(assetsSearchRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /assets/search", () => {
  const app = buildApp();

  it("returns ranked asset matches for an exact code query", async () => {
    const res = await request(app).get("/assets/search?q=USDC");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].code).toBe("USDC");
    expect(res.body.data[0].trustCount).toBeGreaterThanOrEqual(0);
  });

  it("returns partial matches for a prefix query", async () => {
    const res = await request(app).get("/assets/search?q=usd");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.some((asset: { code: string }) => asset.code === "USDC")).toBe(true);
    expect(res.body.data.some((asset: { code: string }) => asset.code === "USDT")).toBe(true);
  });

  it("returns an empty payload for unknown queries", async () => {
    const res = await request(app).get("/assets/search?q=zzzz-no-match");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});
