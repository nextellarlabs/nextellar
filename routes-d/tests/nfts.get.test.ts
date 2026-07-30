import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import nftsGetRouter, {
  __resetNftGet,
  __seedNft,
} from "../routes/nfts.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(nftsGetRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /nfts/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNftGet();
  });

  it("returns 404 for an unknown NFT id", async () => {
    const res = await request(app).get("/nfts/unknown-id");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NFT_NOT_FOUND");
  });

  it("returns the NFT with on-chain data for a known id", async () => {
    __seedNft("nft-1", {
      id: "nft-1",
      tokenId: "token-1",
      collectionId: "collection-alpha",
      ownerUserId: "user-abc",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      onChainData: { contractId: "CABC123", mintLedger: 1000 },
    });

    const res = await request(app).get("/nfts/nft-1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("nft-1");
    expect(res.body.data.onChainData.contractId).toBe("CABC123");
    expect(res.body.fromCache).toBe(false);
  });

  it("returns null displayMetadata when no off-chain metadata is seeded", async () => {
    __seedNft("nft-2", {
      id: "nft-2",
      tokenId: "token-2",
      collectionId: "collection-beta",
      ownerUserId: "user-xyz",
      acquiredAt: "2026-02-01T00:00:00.000Z",
    });

    const res = await request(app).get("/nfts/nft-2");
    expect(res.status).toBe(200);
    expect(res.body.data.displayMetadata).toBeNull();
  });

  it("hydrates displayMetadata when off-chain metadata is present", async () => {
    __seedNft("nft-3", {
      id: "nft-3",
      tokenId: "token-3",
      collectionId: "collection-alpha",
      ownerUserId: "user-abc",
      acquiredAt: "2026-03-01T00:00:00.000Z",
      displayMetadata: {
        name: "Cool NFT #3",
        image: "ipfs://Qm123",
        attributes: [{ trait_type: "Background", value: "Blue" }],
      },
    });

    const res = await request(app).get("/nfts/nft-3");
    expect(res.status).toBe(200);
    expect(res.body.data.displayMetadata.name).toBe("Cool NFT #3");
    expect(res.body.data.displayMetadata.attributes[0].trait_type).toBe("Background");
  });

  it("returns fromCache: true on second request for the same NFT within TTL", async () => {
    __seedNft("nft-4", {
      id: "nft-4",
      tokenId: "token-4",
      collectionId: "collection-alpha",
      ownerUserId: "user-abc",
      acquiredAt: "2026-04-01T00:00:00.000Z",
    });

    const first = await request(app).get("/nfts/nft-4");
    expect(first.body.fromCache).toBe(false);

    const second = await request(app).get("/nfts/nft-4");
    expect(second.body.fromCache).toBe(true);
    expect(second.body.data.id).toBe("nft-4");
  });
});
