import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import nftsCollectionsListRouter, {
  __resetCollectionsList,
  __seedCollectionsList,
} from "../routes/nfts.collections.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(nftsCollectionsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const COLLECTIONS = [
  { id: "c1", name: "Alpha Art", category: "art", floorPrice: "50.00", volume24h: "5000.00", itemCount: 100 },
  { id: "c2", name: "Beta Gaming", category: "gaming", floorPrice: "20.00", volume24h: "15000.00", itemCount: 250 },
  { id: "c3", name: "Gamma Art", category: "art", floorPrice: "75.00", volume24h: "3000.00", itemCount: 50 },
];

describe("GET /nfts/collections", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetCollectionsList();
  });

  it("returns an empty list when no collections are seeded", async () => {
    const res = await request(app).get("/nfts/collections");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.collections).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("filters collections by category", async () => {
    __seedCollectionsList(COLLECTIONS);

    const res = await request(app).get("/nfts/collections?category=art");
    expect(res.status).toBe(200);
    expect(res.body.data.collections.length).toBe(2);
    expect(
      res.body.data.collections.every((c: { category: string }) => c.category === "art"),
    ).toBe(true);
  });

  it("sorts collections by floor price descending with stable order", async () => {
    __seedCollectionsList(COLLECTIONS);

    const res = await request(app).get("/nfts/collections?sortBy=floorPrice");
    expect(res.status).toBe(200);
    const prices = res.body.data.collections.map(
      (c: { floorPrice: string }) => parseFloat(c.floorPrice),
    );
    for (let i = 0; i < prices.length - 1; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i + 1]);
    }
  });
});
