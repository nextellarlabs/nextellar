import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import nftsMintRouter, {
  __getMintedTransactions,
  __resetNftMint,
  __seedNftCollection,
} from "../routes/nfts.mint.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(nftsMintRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const MINTER_ID = "minter-1";
const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const validMint = {
  collectionId: "collection-alpha",
  recipient: RECIPIENT,
  metadata: {
    name: "Founders Badge",
    image: "ipfs://founders-badge",
    description: "Early Nextellar supporter badge",
  },
};

describe("POST /nfts/mint", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNftMint();
    __seedNftCollection({
      id: "collection-alpha",
      contractId: "contract-alpha",
      authorizedMinters: [MINTER_ID],
    });
  });

  it("returns an unsigned envelope for an authorized mint request", async () => {
    const res = await request(app)
      .post("/nfts/mint")
      .set("x-minter-id", MINTER_ID)
      .send(validMint);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unsignedEnvelope).toBeDefined();
    expect(res.body.data.submitted).toBe(false);
  });

  it("submits a mint and returns a transaction id when requested", async () => {
    const res = await request(app)
      .post("/nfts/mint")
      .set("x-minter-id", MINTER_ID)
      .send({ ...validMint, submit: true });

    expect(res.status).toBe(201);
    expect(res.body.data.transactionId).toMatch(/^tx_/);
    expect(res.body.data.tokenId).toMatch(/^nft_collection-alpha_/);
    expect(__getMintedTransactions()).toHaveLength(1);
  });

  it("rejects invalid metadata", async () => {
    const res = await request(app)
      .post("/nfts/mint")
      .set("x-minter-id", MINTER_ID)
      .send({
        ...validMint,
        metadata: { name: "", image: "ipfs://missing-name" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_METADATA");
  });

  it("rejects unauthorized minters", async () => {
    const res = await request(app)
      .post("/nfts/mint")
      .set("x-minter-id", "minter-2")
      .send(validMint);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED_MINTER");
  });
});
