import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import nftsListRouter, {
  __resetNftList,
  __seedNftHoldings,
  __seedNftMetadata,
} from "../routes/nfts.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(nftsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-abc123";

const holdings = [
  {
    id: "holding-1",
    tokenId: "token-1",
    collectionId: "collection-alpha",
    ownerUserId: USER_ID,
    acquiredAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "holding-2",
    tokenId: "token-2",
    collectionId: "collection-beta",
    ownerUserId: USER_ID,
    acquiredAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "holding-3",
    tokenId: "token-3",
    collectionId: "collection-alpha",
    ownerUserId: USER_ID,
    acquiredAt: "2026-01-03T00:00:00.000Z",
  },
];

describe("GET /nfts", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNftList();
  });

  it("returns an empty NFT list for a user with no holdings", async () => {
    const res = await request(app)
      .get("/nfts")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("filters NFTs by collection and hydrates display metadata", async () => {
    __seedNftHoldings(USER_ID, holdings);
    __seedNftMetadata("token-1", {
      name: "Alpha One",
      image: "ipfs://alpha-one",
    });

    const res = await request(app)
      .get("/nfts?collection=collection-alpha")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((nft: { collectionId: string }) => nft.collectionId === "collection-alpha")).toBe(true);
    expect(res.body.data[0].displayMetadata.name).toBe("Alpha One");
    expect(res.body.data[1].displayMetadata).toBeNull();
  });

  it("paginates NFT holdings", async () => {
    __seedNftHoldings(USER_ID, holdings);

    const res = await request(app)
      .get("/nfts?page=2&limit=2")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].tokenId).toBe("token-3");
    expect(res.body.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });
});
