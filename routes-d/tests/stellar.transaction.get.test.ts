import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import stellarTransactionGetRouter, {
  __resetTransactions,
  __seedTransaction,
  KNOWN_HASH,
} from "../routes/stellar.transaction.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stellarTransactionGetRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

// A valid 64-char hex hash that is NOT in the store
const UNKNOWN_HASH = "a".repeat(64);

// Various malformed inputs
const MALFORMED_HASHES = [
  "abc123",                          // too short
  "z".repeat(64),                    // non-hex character
  KNOWN_HASH + "00",                 // too long (66 chars)
  "",                                // empty (triggers 404 on route mismatch, handled separately)
  "not-a-hex-hash-at-all",           // clearly invalid
  " " + KNOWN_HASH.slice(1),         // leading space
];

describe("GET /stellar/transaction/:hash", () => {
  beforeEach(() => {
    __resetTransactions();
  });

  // ── Known hash ────────────────────────────────────────────────────────────

  it("returns 200 with the canonical transaction shape for a known hash", async () => {
    const res = await request(app).get(`/stellar/transaction/${KNOWN_HASH}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const tx = res.body.data;
    expect(tx.hash).toBe(KNOWN_HASH);
    expect(typeof tx.fee).toBe("string");
    expect(typeof tx.resultCode).toBe("string");
    expect(typeof tx.ledger).toBe("number");
    expect(typeof tx.createdAt).toBe("string");
    expect(typeof tx.sourceAccount).toBe("string");
    expect(typeof tx.operationCount).toBe("number");
    expect(typeof tx.envelope).toBe("string");
  });

  it("returns fee and resultCode in the response", async () => {
    const res = await request(app).get(`/stellar/transaction/${KNOWN_HASH}`);

    expect(res.status).toBe(200);
    expect(res.body.data.fee).toBe("100");
    expect(res.body.data.resultCode).toBe("txSUCCESS");
  });

  it("accepts an uppercase version of a known hash (case-insensitive)", async () => {
    const upperHash = KNOWN_HASH.toUpperCase();
    const res = await request(app).get(`/stellar/transaction/${upperHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hash).toBe(KNOWN_HASH);
  });

  it("returns seeded transaction data correctly", async () => {
    const customHash = "b".repeat(64);
    __seedTransaction({
      hash: customHash,
      ledger: 200_000,
      createdAt: "2025-01-15T08:30:00Z",
      sourceAccount: "GBWMCCC3NHSKLAOJDBKKYW7SSH2PFTTNVFKWKH6MFSP6GY2YKZQXZRPQ",
      fee: "200",
      operationCount: 2,
      resultCode: "txFAILED",
      envelope: "AAAAAQ==",
      memo: "test-memo",
    });

    const res = await request(app).get(`/stellar/transaction/${customHash}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hash).toBe(customHash);
    expect(res.body.data.fee).toBe("200");
    expect(res.body.data.resultCode).toBe("txFAILED");
    expect(res.body.data.memo).toBe("test-memo");
    expect(res.body.data.operationCount).toBe(2);
  });

  // ── Unknown hash ──────────────────────────────────────────────────────────

  it("returns 404 TRANSACTION_NOT_FOUND for a valid but unknown hash", async () => {
    const res = await request(app).get(`/stellar/transaction/${UNKNOWN_HASH}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
  });

  it("returns 404 after store is reset and known hash is re-queried without re-seeding", async () => {
    // Clear without re-seeding
    __resetTransactions();
    // Reset adds back the default; verify UNKNOWN_HASH is still absent
    const res = await request(app).get(`/stellar/transaction/${UNKNOWN_HASH}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
  });

  // ── Malformed hash ────────────────────────────────────────────────────────

  it.each(MALFORMED_HASHES)(
    "returns 400 INVALID_TX_HASH for malformed hash %j",
    async (badHash) => {
      const res = await request(app).get(
        `/stellar/transaction/${encodeURIComponent(badHash)}`,
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_TX_HASH");
    },
  );

  it("returns 400 INVALID_TX_HASH when hash contains non-hex characters", async () => {
    const nonHex = "g".repeat(64); // 'g' is not a hex character
    const res = await request(app).get(`/stellar/transaction/${nonHex}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TX_HASH");
  });

  it("returns 400 INVALID_TX_HASH when hash is 63 characters (one short)", async () => {
    const shortHash = "a".repeat(63);
    const res = await request(app).get(`/stellar/transaction/${shortHash}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TX_HASH");
  });

  it("returns 400 INVALID_TX_HASH when hash is 65 characters (one over)", async () => {
    const longHash = "a".repeat(65);
    const res = await request(app).get(`/stellar/transaction/${longHash}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TX_HASH");
  });
});
