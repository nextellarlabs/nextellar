import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import metadataRefreshRouter, {
  __hasMetadataCache,
  __resetMetadataRefresh,
  __seedMetadataCache,
  __seedNftToken,
} from "../routes/nfts.metadata.refresh.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(metadataRefreshRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const token = {
  tokenId: "token-1",
  collectionId: "collection-alpha",
  metadataUri: "ipfs://token-1",
  metadata: {
    name: " Alpha One ",
    image: "ipfs://alpha-one",
  },
};

describe("POST /nfts/metadata/refresh", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetMetadataRefresh();
    __seedNftToken(token);
  });

  it("refreshes metadata and invalidates cached entries", async () => {
    __seedMetadataCache("token-1", { name: "Stale Alpha One" });

    const res = await request(app)
      .post("/nfts/metadata/refresh")
      .send({ tokenId: "token-1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metadata.name).toBe("Alpha One");
    expect(res.body.data.cacheInvalidated).toBe(true);
    expect(__hasMetadataCache("token-1")).toBe(false);
  });

  it("throttles repeated refreshes per token", async () => {
    const first = await request(app)
      .post("/nfts/metadata/refresh")
      .send({ tokenId: "token-1" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/nfts/metadata/refresh")
      .send({ tokenId: "token-1" });

    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
  });

  it("returns unknown token errors without consuming another token rate limit", async () => {
    const res = await request(app)
      .post("/nfts/metadata/refresh")
      .send({ tokenId: "missing-token" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TOKEN_NOT_FOUND");
  });
});
