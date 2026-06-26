import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import nftsFloorRouter, {
  __resetListingStore,
  __seedListings,
  __seedFloorCache,
} from "../routes/nfts.floor.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(nftsFloorRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const COLLECTION_ID = "collection-stellar-punks";

const activeListings = [
  { collectionId: COLLECTION_ID, price: 150, seller: "GABC", tokenId: "token-1", active: true },
  { collectionId: COLLECTION_ID, price: 120, seller: "GDEF", tokenId: "token-2", active: true },
  { collectionId: COLLECTION_ID, price: 200, seller: "GXYZ", tokenId: "token-3", active: true },
];

const inactiveListings = [
  { collectionId: COLLECTION_ID, price: 50, seller: "GABC", tokenId: "token-4", active: false },
];

describe("GET /nfts/floor", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetListingStore();
  });

  it("returns 200 with the floor price for a normal market", async () => {
    __seedListings(COLLECTION_ID, activeListings);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.floorPrice).toBe(120);
    expect(res.body.data.collectionId).toBe(COLLECTION_ID);
    expect(res.body.data.currency).toBe("XLM");
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns the correct floor price (minimum active listing price)", async () => {
    __seedListings(COLLECTION_ID, [
      ...activeListings,
      { collectionId: COLLECTION_ID, price: 80, seller: "GNEW", tokenId: "token-5", active: true },
    ]);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.floorPrice).toBe(80);
  });

  it("ignores inactive listings when computing floor price", async () => {
    __seedListings(COLLECTION_ID, [...activeListings, ...inactiveListings]);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    // inactive listing has price 50, floor should still be 120 from active listings
    expect(res.body.data.floorPrice).toBe(120);
  });

  it("returns 404 NO_ACTIVE_LISTINGS for a sparse market with only inactive listings", async () => {
    __seedListings(COLLECTION_ID, inactiveListings);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NO_ACTIVE_LISTINGS");
  });

  it("returns 404 COLLECTION_NOT_FOUND for a missing collection", async () => {
    const res = await request(app).get("/nfts/floor?collectionId=unknown-collection");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("COLLECTION_NOT_FOUND");
  });

  it("returns 400 INVALID_COLLECTION_ID when collectionId is missing", async () => {
    const res = await request(app).get("/nfts/floor");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COLLECTION_ID");
  });

  it("returns 400 INVALID_COLLECTION_ID when collectionId is empty string", async () => {
    const res = await request(app).get("/nfts/floor?collectionId=");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COLLECTION_ID");
  });

  it("returns fromCache: true on a second identical request within the TTL window", async () => {
    __seedListings(COLLECTION_ID, activeListings);

    await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);
    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns the seeded cache entry as a cache hit", async () => {
    const seedData = {
      collectionId: COLLECTION_ID,
      floorPrice: 95,
      currency: "XLM",
      activeListings: 5,
      fromCache: false,
    };
    __seedFloorCache(COLLECTION_ID, seedData);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.floorPrice).toBe(95);
  });

  it("response data has the expected shape", async () => {
    __seedListings(COLLECTION_ID, activeListings);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("collectionId");
    expect(res.body.data).toHaveProperty("floorPrice");
    expect(res.body.data).toHaveProperty("currency");
    expect(res.body.data).toHaveProperty("activeListings");
    expect(res.body.data).toHaveProperty("fromCache");
  });

  it("activeListings count matches the number of active listings in the store", async () => {
    __seedListings(COLLECTION_ID, [...activeListings, ...inactiveListings]);

    const res = await request(app).get(`/nfts/floor?collectionId=${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.activeListings).toBe(3);
  });
});
