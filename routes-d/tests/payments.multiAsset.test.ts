// Tests for the multi-asset payments endpoint (#290).

import express, { type Express } from "express";
import request from "supertest";
import { createMultiAssetPaymentRouter } from "../routes/payments.multiAsset.js";

const VALID_DEST = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";

function buildApp(maxOps?: number): Express {
  const app = express();
  app.use(express.json());
  app.use("/payments", createMultiAssetPaymentRouter({ maxOps }));
  return app;
}

describe("POST /payments/multi-asset (#290)", () => {
  it("returns an envelope for a single valid operation", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({
        operations: [
          { destination: VALID_DEST, amount: "10.5", asset: { code: "USDC", issuer: "GABC" } },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.envelope).toMatch(/envelope_multi/);
    expect(res.body.operationCount).toBe(1);
  });

  it("returns an envelope for multiple valid operations", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({
        operations: [
          { destination: VALID_DEST, amount: "5", asset: { code: "XLM" } },
          { destination: VALID_DEST, amount: "20", asset: { code: "EURT", issuer: "GISSUER" } },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.operationCount).toBe(2);
  });

  it("rejects an empty operations array", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({ operations: [] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("rejects when operations is missing", async () => {
    const res = await request(buildApp()).post("/payments/multi-asset").send({});
    expect(res.status).toBe(400);
  });

  it("rejects when too many operations are provided", async () => {
    const ops = Array.from({ length: 5 }, () => ({
      destination: VALID_DEST,
      amount: "1",
      asset: { code: "XLM" },
    }));
    const res = await request(buildApp(3))
      .post("/payments/multi-asset")
      .send({ operations: ops });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too many operations/);
  });

  it("returns per-operation errors for invalid destinations", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({
        operations: [
          { destination: "INVALID", amount: "10", asset: { code: "XLM" } },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.operationErrors).toHaveLength(1);
    expect(res.body.operationErrors[0].index).toBe(0);
  });

  it("returns per-operation errors for zero amount", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({
        operations: [
          { destination: VALID_DEST, amount: "0", asset: { code: "XLM" } },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.operationErrors[0].errors[0].field).toBe("amount");
  });

  it("collects errors from all invalid operations in one response", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({
        operations: [
          { destination: "BAD1", amount: "0", asset: { code: "XLM" } },
          { destination: "BAD2", amount: "-5", asset: { code: "XLM" } },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.operationErrors).toHaveLength(2);
  });

  it("accepts an optional memo field", async () => {
    const res = await request(buildApp())
      .post("/payments/multi-asset")
      .send({
        operations: [
          {
            destination: VALID_DEST,
            amount: "1",
            asset: { code: "XLM" },
            memo: "invoice-42",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.operations[0].memo).toBe("invoice-42");
  });
});
