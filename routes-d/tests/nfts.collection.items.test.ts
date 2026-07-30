import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import nftsCollectionItemsRouter, {
  __resetCollectionItems,
  __seedCollectionItems,
  __seedCollectionItemMetadata,
} from "../routes/nfts.collection.items.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(nftsCollectionItemsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const COLLECTION_ID = "collection-alpha";

const ITEMS = [
  {
    id: "item-1",
    tokenId: "token-1",
    collectionId: COLLECTION_ID,
    ownerUserId: "user-a",
    acquiredAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "item-2",
    tokenId: "token-2",
    collectionId: COLLECTION_ID,
    ownerUserId: "user-b",
    acquiredAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "item-3",
    tokenId: "token-3",
    collectionId: COLLECTION_ID,
    ownerUserId: "user-c",
    acquiredAt: "2026-01-03T00:00:00.000Z",
  },
];

describe("GET /collections/:id/items", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetCollectionItems();
  });

  it("returns empty items array for a collection with no items", async () => {
    const res = await request(app).get(`/collections/${COLLECTION_ID}/items`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("filters items by trait_type and trait_value", async () => {
    __seedCollectionItems(COLLECTION_ID, ITEMS);
    __seedCollectionItemMetadata("token-1", {
      name: "Alpha One",
      attributes: [{ trait_type: "Background", value: "Blue" }],
    });
    __seedCollectionItemMetadata("token-2", {
      name: "Alpha Two",
      attributes: [{ trait_type: "Background", value: "Red" }],
    });

    const res = await request(app).get(
      `/collections/${COLLECTION_ID}/items?trait_type=Background&trait_value=Blue`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].tokenId).toBe("token-1");
  });

  it("paginates items correctly", async () => {
    __seedCollectionItems(COLLECTION_ID, ITEMS);

    const res = await request(app).get(
      `/collections/${COLLECTION_ID}/items?page=2&limit=2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].tokenId).toBe("token-3");
    expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it("hydrates displayMetadata for items that have it", async () => {
    __seedCollectionItems(COLLECTION_ID, ITEMS.slice(0, 1));
    __seedCollectionItemMetadata("token-1", { name: "Hydrated One", image: "ipfs://Qm1" });

    const res = await request(app).get(`/collections/${COLLECTION_ID}/items`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].displayMetadata.name).toBe("Hydrated One");
  });
});
