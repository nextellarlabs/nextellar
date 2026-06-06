import request from "supertest";
import express from "express";
import {
  createStellarPathsRouter,
  pathsCache,
  type PathRecord,
  type PathsFetcher,
} from "../routes/stellar.paths.js";

function buildApp(fetcher: PathsFetcher) {
  const app = express();
  app.use(express.json());
  app.use(createStellarPathsRouter({ fetcher }));
  return app;
}

beforeEach(() => {
  pathsCache.clear();
});

describe("Stellar Path Payment Estimator", () => {
  it("returns 400 for strict-receive if destinationAmount is missing", async () => {
    const fetcher: PathsFetcher = async () => [];
    const app = buildApp(fetcher);
    const res = await request(app)
      .get("/stellar/paths/strict-receive")
      .query({
        destinationAssetType: "native",
        sourceAssets: "native",
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "missing_or_invalid_destination_amount" });
  });

  it("returns 400 for strict-receive if destination_amount is 0 or negative", async () => {
    const fetcher: PathsFetcher = async () => [];
    const app = buildApp(fetcher);
    const res = await request(app)
      .get("/stellar/paths/strict-receive")
      .query({
        destination_amount: "-1",
        destination_asset_type: "native",
        source_assets: "native",
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "missing_or_invalid_destination_amount" });
  });

  it("accepts snake_case parameters and returns correctly ranked paths (strict-receive)", async () => {
    const mockRecords: PathRecord[] = [
      {
        source_asset_type: "native",
        source_amount: "5.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        destination_amount: "1.0000000",
        path: [],
      },
      {
        source_asset_type: "native",
        source_amount: "3.5000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        destination_amount: "1.0000000",
        path: [],
      },
      {
        source_asset_type: "native",
        source_amount: "10.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        destination_amount: "1.0000000",
        path: [],
      },
    ];

    const fetcher: PathsFetcher = async (flow, params) => {
      expect(flow).toBe("strict-receive");
      expect(params.get("destination_amount")).toBe("1.0000000");
      expect(params.get("destination_asset_type")).toBe("credit_alphanum4");
      expect(params.get("destination_asset_code")).toBe("USDC");
      expect(params.get("destination_asset_issuer")).toBe("GBBD...");
      expect(params.get("source_assets")).toBe("native");
      return mockRecords;
    };

    const app = buildApp(fetcher);
    const res = await request(app)
      .get("/stellar/paths/strict-receive")
      .query({
        destination_amount: "1.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        source_assets: "native",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.flow).toBe("strict-receive");
    expect(res.body.data.fromCache).toBe(false);

    // Verify ranking: lowest cost (source_amount) first
    expect(res.body.data.paths).toHaveLength(3);
    expect(res.body.data.paths[0].sourceAmount).toBe("3.5000000");
    expect(res.body.data.paths[1].sourceAmount).toBe("5.0000000");
    expect(res.body.data.paths[2].sourceAmount).toBe("10.0000000");

    // Verify formatting
    expect(res.body.data.paths[0].sourceAsset).toBe("native");
    expect(res.body.data.paths[0].destinationAsset).toBe("USDC:GBBD...");
    expect(res.body.data.paths[0].estimatedCost).toBe("3.5000000");
    expect(res.body.data.paths[0].estimatedReceive).toBe("1.0000000");
  });

  it("accepts camelCase parameters and returns correctly ranked paths (strict-send)", async () => {
    const mockRecords: PathRecord[] = [
      {
        source_asset_type: "native",
        source_amount: "100.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        destination_amount: "10.0000000",
        path: [],
      },
      {
        source_asset_type: "native",
        source_amount: "100.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        destination_amount: "15.5000000",
        path: [],
      },
      {
        source_asset_type: "native",
        source_amount: "100.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GBBD...",
        destination_amount: "8.0000000",
        path: [],
      },
    ];

    const fetcher: PathsFetcher = async (flow, params) => {
      expect(flow).toBe("strict-send");
      expect(params.get("source_amount")).toBe("100.0000000");
      expect(params.get("source_asset_type")).toBe("native");
      expect(params.get("destination_assets")).toBe("USDC:GBBD...");
      return mockRecords;
    };

    const app = buildApp(fetcher);
    const res = await request(app)
      .get("/stellar/paths/strict-send")
      .query({
        sourceAmount: "100.0000000",
        sourceAssetType: "native",
        destinationAssets: "USDC:GBBD...",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.flow).toBe("strict-send");

    // Verify ranking: highest receive (destination_amount) first
    expect(res.body.data.paths).toHaveLength(3);
    expect(res.body.data.paths[0].destinationAmount).toBe("15.5000000");
    expect(res.body.data.paths[1].destinationAmount).toBe("10.0000000");
    expect(res.body.data.paths[2].destinationAmount).toBe("8.0000000");
  });

  it("caches identical requests and respects force refresh", async () => {
    let calls = 0;
    const mockRecords: PathRecord[] = [
      {
        source_asset_type: "native",
        source_amount: "1.0000000",
        destination_asset_type: "native",
        destination_amount: "1.0000000",
        path: [],
      },
    ];
    const fetcher: PathsFetcher = async () => {
      calls++;
      return mockRecords;
    };

    const app = buildApp(fetcher);

    // First request: Cache miss
    const res1 = await request(app)
      .get("/stellar/paths/strict-send")
      .query({
        sourceAmount: "1.0000000",
        sourceAssetType: "native",
        destinationAssets: "USDC:GBBD...",
      });
    expect(res1.status).toBe(200);
    expect(res1.body.data.fromCache).toBe(false);
    expect(calls).toBe(1);

    // Second request: Cache hit
    const res2 = await request(app)
      .get("/stellar/paths/strict-send")
      .query({
        sourceAmount: "1.0000000",
        sourceAssetType: "native",
        destinationAssets: "USDC:GBBD...",
      });
    expect(res2.status).toBe(200);
    expect(res2.body.data.fromCache).toBe(true);
    expect(calls).toBe(1);

    // Force refresh request: Cache bypass
    const res3 = await request(app)
      .get("/stellar/paths/strict-send")
      .query({
        sourceAmount: "1.0000000",
        sourceAssetType: "native",
        destinationAssets: "USDC:GBBD...",
        refresh: "true",
      });
    expect(res3.status).toBe(200);
    expect(res3.body.data.fromCache).toBe(false);
    expect(calls).toBe(2);
  });

  it("returns 200 with an empty list of paths for no-path cases", async () => {
    const fetcher: PathsFetcher = async () => [];
    const app = buildApp(fetcher);
    const res = await request(app)
      .get("/stellar/paths/strict-receive")
      .query({
        destinationAmount: "1.0000000",
        destinationAssetType: "native",
        sourceAssets: "USDC:GBBD...",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.paths).toEqual([]);
    expect(res.body.data.raw).toEqual([]);
  });

  it("handles non-200 Horizon response codes gracefully", async () => {
    const fetcher: PathsFetcher = async () => {
      throw new Error("horizon_paths_lookup_failed_404");
    };
    const app = buildApp(fetcher);
    const res = await request(app)
      .get("/stellar/paths/strict-receive")
      .query({
        destinationAmount: "1.0000000",
        destinationAssetType: "native",
        sourceAssets: "USDC:GBBD...",
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("horizon_paths_lookup_failed");
  });
});
