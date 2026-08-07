import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import listingsCreateRouter, {
  __closeListing,
  __getEscrow,
  __getListing,
  __getLockedQuantity,
  __resetMarketplace,
  __seedAsset,
} from "../routes/listings.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(listingsCreateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();
const asset = {
  assetId: "asset-1",
  ownerId: "seller-1",
  assetCode: "USDC",
  assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  assetType: "token" as const,
  quantity: 2,
};
const body = { assetId: asset.assetId, quantity: 1, price: 100, currency: "usd" };

beforeEach(() => {
  __resetMarketplace();
  __seedAsset(asset);
});

describe("POST /listings", () => {
  it("creates a listing and locks the asset quantity in escrow", async () => {
    const res = await request(app).post("/listings").set("x-owner-id", "seller-1").send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sellerId).toBe("seller-1");
    expect(res.body.data.status).toBe("open");
    expect(res.body.data.currency).toBe("USD");
    expect(res.body.data.escrowId).toMatch(/^escrow-/);
    expect(__getLockedQuantity(asset.assetId)).toBe(1);
    expect(__getEscrow(res.body.data.escrowId)).toEqual(
      expect.objectContaining({
        assetId: asset.assetId,
        ownerId: "seller-1",
        quantity: 1,
        status: "locked",
      }),
    );
  });

  it("rejects a caller who does not own the asset", async () => {
    const res = await request(app).post("/listings").set("x-owner-id", "seller-2").send(body);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_OWNER");
    expect(__getLockedQuantity(asset.assetId)).toBe(0);
  });

  it("rejects a second open listing for the same asset", async () => {
    const first = await request(app).post("/listings").set("x-owner-id", "seller-1").send(body);
    const second = await request(app).post("/listings").set("x-owner-id", "seller-1").send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_LISTING");
    expect(__getLockedQuantity(asset.assetId)).toBe(1);
  });

  it("releases escrow when a listing closes", async () => {
    const created = await request(app).post("/listings").set("x-owner-id", "seller-1").send(body);
    const listingId = created.body.data.id as string;
    const escrowId = created.body.data.escrowId as string;

    expect(__closeListing(listingId, "cancelled")).toBe(true);
    expect(__getListing(listingId)?.status).toBe("cancelled");
    expect(__getEscrow(escrowId)?.status).toBe("released");
    expect(__getLockedQuantity(asset.assetId)).toBe(0);
  });
});
