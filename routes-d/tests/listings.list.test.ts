import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import listingsRouter, {
  __resetListings,
  __seedListings,
  __getListings,
  Listing,
} from "../routes/listings.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(listingsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: `listing-${Math.random().toString(36).slice(2)}`,
  sellerId: "seller-001",
  assetCode: "USDC",
  assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  assetType: "token",
  price: 100,
  currency: "USD",
  quantity: 1,
  status: "open",
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-01T12:00:00.000Z",
  ...overrides,
});

const openListings: Listing[] = [
  makeListing({
    id: "listing-001",
    assetType: "nft",
    collectionId: "collection-alpha",
    price: 50,
    createdAt: "2026-01-01T10:00:00.000Z",
  }),
  makeListing({
    id: "listing-002",
    assetType: "token",
    price: 200,
    createdAt: "2026-01-02T10:00:00.000Z",
  }),
  makeListing({
    id: "listing-003",
    assetType: "nft",
    collectionId: "collection-alpha",
    price: 300,
    createdAt: "2026-01-03T10:00:00.000Z",
  }),
  makeListing({
    id: "listing-004",
    assetType: "bond",
    price: 1000,
    createdAt: "2026-01-04T10:00:00.000Z",
  }),
  makeListing({
    id: "listing-005",
    assetType: "token",
    collectionId: "collection-beta",
    price: 75,
    createdAt: "2026-01-05T10:00:00.000Z",
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /listings", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetListings();
  });

  // -------------------------------------------------------------------------
  // Empty store
  // -------------------------------------------------------------------------

  describe("empty store", () => {
    it("returns 200 with an empty data array when no listings exist", async () => {
      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.totalPages).toBe(1);
      expect(res.body.pagination.hasNext).toBe(false);
    });

    it("returns empty data even when filters are applied", async () => {
      const res = await request(app).get("/listings?assetType=nft&collection=col-1");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Basic listing shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns listings with expected fields", async () => {
      __seedListings([openListings[0]]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      const item = res.body.data[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("sellerId");
      expect(item).toHaveProperty("assetCode");
      expect(item).toHaveProperty("assetIssuer");
      expect(item).toHaveProperty("assetType");
      expect(item).toHaveProperty("price");
      expect(item).toHaveProperty("currency");
      expect(item).toHaveProperty("quantity");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("updatedAt");
    });

    it("only returns open listings — skips filled, cancelled, and expired", async () => {
      __seedListings([
        makeListing({ id: "open-1", status: "open" }),
        makeListing({ id: "filled-1", status: "filled" }),
        makeListing({ id: "cancelled-1", status: "cancelled" }),
        makeListing({ id: "expired-1", status: "expired" }),
      ]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe("open-1");
    });
  });

  // -------------------------------------------------------------------------
  // Filtering by collection
  // -------------------------------------------------------------------------

  describe("filter: collection", () => {
    beforeEach(() => {
      __seedListings(openListings);
    });

    it("filters by collection and returns only matching listings", async () => {
      const res = await request(app).get("/listings?collection=collection-alpha");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      res.body.data.forEach((l: Listing) => {
        expect(l.collectionId).toBe("collection-alpha");
      });
    });

    it("returns empty data when no listings match the collection", async () => {
      const res = await request(app).get("/listings?collection=nonexistent");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it("filters by collection-beta", async () => {
      const res = await request(app).get("/listings?collection=collection-beta");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe("listing-005");
    });
  });

  // -------------------------------------------------------------------------
  // Filtering by assetType
  // -------------------------------------------------------------------------

  describe("filter: assetType", () => {
    beforeEach(() => {
      __seedListings(openListings);
    });

    it("filters by assetType=nft", async () => {
      const res = await request(app).get("/listings?assetType=nft");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      res.body.data.forEach((l: Listing) => {
        expect(l.assetType).toBe("nft");
      });
    });

    it("filters by assetType=token", async () => {
      const res = await request(app).get("/listings?assetType=token");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      res.body.data.forEach((l: Listing) => {
        expect(l.assetType).toBe("token");
      });
    });

    it("filters by assetType=bond", async () => {
      const res = await request(app).get("/listings?assetType=bond");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].assetType).toBe("bond");
    });

    it("returns 400 INVALID_ASSET_TYPE for unrecognised assetType", async () => {
      const res = await request(app).get("/listings?assetType=unknown");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_ASSET_TYPE");
    });

    it("returns 400 for each invalid asset type variant", async () => {
      for (const bad of ["crypto", "stock", "123", ""]) {
        if (bad === "") continue; // empty string is ignored (undefined-like)
        const res = await request(app).get(`/listings?assetType=${bad}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_ASSET_TYPE");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Filtering by price range
  // -------------------------------------------------------------------------

  describe("filter: price range", () => {
    beforeEach(() => {
      __seedListings(openListings);
    });

    it("filters by minPrice", async () => {
      const res = await request(app).get("/listings?minPrice=200");

      expect(res.status).toBe(200);
      res.body.data.forEach((l: Listing) => {
        expect(l.price).toBeGreaterThanOrEqual(200);
      });
    });

    it("filters by maxPrice", async () => {
      const res = await request(app).get("/listings?maxPrice=200");

      expect(res.status).toBe(200);
      res.body.data.forEach((l: Listing) => {
        expect(l.price).toBeLessThanOrEqual(200);
      });
    });

    it("filters by both minPrice and maxPrice", async () => {
      const res = await request(app).get("/listings?minPrice=100&maxPrice=300");

      expect(res.status).toBe(200);
      res.body.data.forEach((l: Listing) => {
        expect(l.price).toBeGreaterThanOrEqual(100);
        expect(l.price).toBeLessThanOrEqual(300);
      });
    });

    it("minPrice is inclusive", async () => {
      const res = await request(app).get("/listings?minPrice=50");

      expect(res.status).toBe(200);
      const prices = res.body.data.map((l: Listing) => l.price);
      expect(prices).toContain(50);
    });

    it("maxPrice is inclusive", async () => {
      const res = await request(app).get("/listings?maxPrice=50");

      expect(res.status).toBe(200);
      const prices = res.body.data.map((l: Listing) => l.price);
      expect(prices).toContain(50);
    });

    it("returns 400 INVALID_PRICE_RANGE when minPrice > maxPrice", async () => {
      const res = await request(app).get("/listings?minPrice=500&maxPrice=100");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PRICE_RANGE");
    });

    it("returns 400 INVALID_MIN_PRICE for non-numeric minPrice", async () => {
      const res = await request(app).get("/listings?minPrice=abc");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_MIN_PRICE");
    });

    it("returns 400 INVALID_MAX_PRICE for non-numeric maxPrice", async () => {
      const res = await request(app).get("/listings?maxPrice=abc");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_MAX_PRICE");
    });
  });

  // -------------------------------------------------------------------------
  // Combined filters
  // -------------------------------------------------------------------------

  describe("combined filters", () => {
    beforeEach(() => {
      __seedListings(openListings);
    });

    it("filters by assetType and collection together", async () => {
      const res = await request(app).get(
        "/listings?assetType=nft&collection=collection-alpha",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      res.body.data.forEach((l: Listing) => {
        expect(l.assetType).toBe("nft");
        expect(l.collectionId).toBe("collection-alpha");
      });
    });

    it("filters by assetType, collection, and price range", async () => {
      const res = await request(app).get(
        "/listings?assetType=nft&collection=collection-alpha&minPrice=100",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe("listing-003");
    });
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  describe("sorting", () => {
    beforeEach(() => {
      __seedListings(openListings);
    });

    it("defaults to newest first when sortBy is omitted", async () => {
      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      const dates = res.body.data.map((l: Listing) => new Date(l.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });

    it("sortBy=newest returns newest listings first", async () => {
      const res = await request(app).get("/listings?sortBy=newest");

      expect(res.status).toBe(200);
      const ids = res.body.data.map((l: Listing) => l.id);
      expect(ids[0]).toBe("listing-005"); // most recent
    });

    it("sortBy=oldest returns oldest listings first", async () => {
      const res = await request(app).get("/listings?sortBy=oldest");

      expect(res.status).toBe(200);
      const ids = res.body.data.map((l: Listing) => l.id);
      expect(ids[0]).toBe("listing-001"); // oldest
    });

    it("sortBy=price_asc returns cheapest first", async () => {
      const res = await request(app).get("/listings?sortBy=price_asc");

      expect(res.status).toBe(200);
      const prices = res.body.data.map((l: Listing) => l.price);
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1]).toBeLessThanOrEqual(prices[i]);
      }
    });

    it("sortBy=price_desc returns most expensive first", async () => {
      const res = await request(app).get("/listings?sortBy=price_desc");

      expect(res.status).toBe(200);
      const prices = res.body.data.map((l: Listing) => l.price);
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1]).toBeGreaterThanOrEqual(prices[i]);
      }
    });

    it("returns 400 INVALID_SORT_BY for unrecognised sortBy value", async () => {
      const res = await request(app).get("/listings?sortBy=random");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_SORT_BY");
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  describe("pagination", () => {
    const fifteenListings = Array.from({ length: 15 }, (_, i) =>
      makeListing({
        id: `listing-p${String(i + 1).padStart(2, "0")}`,
        price: (i + 1) * 10,
        createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      }),
    );

    beforeEach(() => {
      __seedListings(fifteenListings);
    });

    it("returns first page with default limit of 20", async () => {
      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(15); // less than default limit
      expect(res.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 15,
        totalPages: 1,
        hasNext: false,
      });
    });

    it("paginates correctly — page 1 of 3 with limit=5", async () => {
      const res = await request(app).get("/listings?page=1&limit=5&sortBy=oldest");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
      expect(res.body.pagination).toMatchObject({
        page: 1,
        limit: 5,
        total: 15,
        totalPages: 3,
        hasNext: true,
      });
    });

    it("paginates correctly — page 2 of 3 with limit=5", async () => {
      const res = await request(app).get("/listings?page=2&limit=5&sortBy=oldest");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
      expect(res.body.pagination.hasNext).toBe(true);
      expect(res.body.pagination.page).toBe(2);
    });

    it("paginates correctly — last page has remainder items", async () => {
      const res = await request(app).get("/listings?page=3&limit=5&sortBy=oldest");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
      expect(res.body.pagination.hasNext).toBe(false);
    });

    it("returns empty data for a page beyond the total", async () => {
      const res = await request(app).get("/listings?page=99&limit=5");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.hasNext).toBe(false);
    });

    it("returns 400 INVALID_PAGE for page=0", async () => {
      const res = await request(app).get("/listings?page=0");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PAGE");
    });

    it("returns 400 INVALID_PAGE for non-numeric page", async () => {
      const res = await request(app).get("/listings?page=abc");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PAGE");
    });

    it("returns 400 INVALID_LIMIT for limit=0", async () => {
      const res = await request(app).get("/listings?limit=0");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_LIMIT");
    });

    it("returns 400 INVALID_LIMIT for limit exceeding MAX_LIMIT (100)", async () => {
      const res = await request(app).get("/listings?limit=101");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_LIMIT");
    });
  });

  // -------------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------------

  describe("test helpers", () => {
    it("__getListings returns a copy of the store", () => {
      __seedListings(openListings);
      const stored = __getListings();
      expect(stored.length).toBe(openListings.length);
      // Mutating the returned array should not affect the store
      stored.pop();
      expect(__getListings().length).toBe(openListings.length);
    });

    it("__resetListings clears the store", () => {
      __seedListings(openListings);
      __resetListings();
      expect(__getListings().length).toBe(0);
    });
  });
});
