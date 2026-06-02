// Tests for the claimable balances endpoint (#284).
// Covers create and claim flows, predicate validation, and error paths.

import express, { type Express } from "express";
import request from "supertest";
import { createClaimableBalanceRouter } from "../routes/stellar.claimable.js";

const VALID_ACCOUNT = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";
const VALID_ACCOUNT_2 = "GZZZZZ1234567890ABCDE1234567890ABCDE1234567890ABCDE1234567";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/claimable-balances", createClaimableBalanceRouter());
  return app;
}

// ---------------------------------------------------------------------------
// POST /claimable-balances/create
// ---------------------------------------------------------------------------
describe("POST /claimable-balances/create (#284)", () => {
  it("returns an unsigned envelope for a valid native asset balance", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "100",
        claimants: [{ destination: VALID_ACCOUNT }],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.envelope).toMatch(/envelope_create/);
    expect(res.body.claimantCount).toBe(1);
  });

  it("returns an unsigned envelope for a non-native asset with issuer", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "USDC", issuer: VALID_ACCOUNT_2 },
        amount: "50.5",
        claimants: [{ destination: VALID_ACCOUNT }],
      });
    expect(res.status).toBe(200);
    expect(res.body.asset.code).toBe("USDC");
    expect(res.body.amount).toBe("50.5");
  });

  it("accepts multiple claimants", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [
          { destination: VALID_ACCOUNT },
          { destination: VALID_ACCOUNT_2 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.claimantCount).toBe(2);
  });

  it("accepts an unconditional predicate", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [
          {
            destination: VALID_ACCOUNT,
            predicate: { type: "unconditional" },
          },
        ],
      });
    expect(res.status).toBe(200);
  });

  it("accepts a before_absolute_time predicate", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [
          {
            destination: VALID_ACCOUNT,
            predicate: { type: "before_absolute_time", value: 9999999999 },
          },
        ],
      });
    expect(res.status).toBe(200);
  });

  it("accepts an and predicate with two sub-predicates", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [
          {
            destination: VALID_ACCOUNT,
            predicate: {
              type: "and",
              predicates: [
                { type: "after_absolute_time", value: 1000 },
                { type: "before_absolute_time", value: 9999999999 },
              ],
            },
          },
        ],
      });
    expect(res.status).toBe(200);
  });

  it("rejects missing asset code", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: {},
        amount: "10",
        claimants: [{ destination: VALID_ACCOUNT }],
      });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === "asset.code")).toBe(true);
  });

  it("rejects non-native asset without issuer", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "USDC" },
        amount: "10",
        claimants: [{ destination: VALID_ACCOUNT }],
      });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === "asset.issuer")).toBe(true);
  });

  it("rejects zero amount", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "0",
        claimants: [{ destination: VALID_ACCOUNT }],
      });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === "amount")).toBe(true);
  });

  it("rejects empty claimants array", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === "claimants")).toBe(true);
  });

  it("rejects an invalid claimant destination", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [{ destination: "INVALID" }],
      });
    expect(res.status).toBe(400);
    expect(
      res.body.errors.some((e: { field: string }) => e.field.includes("destination")),
    ).toBe(true);
  });

  it("rejects a time predicate missing value", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [
          {
            destination: VALID_ACCOUNT,
            predicate: { type: "before_absolute_time" },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(
      res.body.errors.some((e: { field: string }) => e.field.includes("value")),
    ).toBe(true);
  });

  it("rejects an and predicate with wrong number of sub-predicates", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/create")
      .send({
        asset: { code: "XLM" },
        amount: "10",
        claimants: [
          {
            destination: VALID_ACCOUNT,
            predicate: {
              type: "and",
              predicates: [{ type: "unconditional" }],
            },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(
      res.body.errors.some((e: { field: string }) => e.field.includes("predicates")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /claimable-balances/claim
// ---------------------------------------------------------------------------
describe("POST /claimable-balances/claim (#284)", () => {
  it("returns an unsigned envelope for a valid claim", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/claim")
      .send({
        balanceId: "00000000abc123",
        claimant: VALID_ACCOUNT,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.envelope).toMatch(/envelope_claim/);
    expect(res.body.balanceId).toBe("00000000abc123");
    expect(res.body.claimant).toBe(VALID_ACCOUNT);
  });

  it("rejects a missing balanceId", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/claim")
      .send({ claimant: VALID_ACCOUNT });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === "balanceId")).toBe(true);
  });

  it("rejects an invalid claimant address", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/claim")
      .send({ balanceId: "00000000abc123", claimant: "NOTVALID" });
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === "claimant")).toBe(true);
  });

  it("rejects when both fields are missing", async () => {
    const res = await request(buildApp())
      .post("/claimable-balances/claim")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
  });
});
