import express, { type Express } from "express";
import request from "supertest";
import {
  Account,
  BASE_FEE,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { createFeeBumpRouter } from "../routes/stellar.tx.feebump.js";

function buildSignedInner(): string {
  const user = Keypair.random();
  const tx = new TransactionBuilder(new Account(user.publicKey(), "1"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "fee-bump-route", value: "ok" }))
    .setTimeout(30)
    .build();

  tx.sign(user);
  return tx.toXDR();
}

function buildApp(server: Keypair, maxBumpFee = "1000"): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/stellar/tx",
    createFeeBumpRouter({
      signer: {
        publicKey: server.publicKey(),
        sign: (transaction) => {
          transaction.sign(server);
        },
      },
      networkPassphrase: Networks.TESTNET,
      maxBumpFee,
    }),
  );
  return app;
}

describe("POST /stellar/tx/feebump", () => {
  it("wraps a valid signed inner transaction in a server-signed fee bump envelope", async () => {
    const server = Keypair.random();
    const res = await request(buildApp(server))
      .post("/stellar/tx/feebump")
      .send({ innerEnvelope: buildSignedInner(), bumpFee: "500" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      feeSource: server.publicKey(),
      bumpFee: "500",
    });
    expect(typeof res.body.envelope).toBe("string");

    const parsed = TransactionBuilder.fromXDR(res.body.envelope, Networks.TESTNET);
    expect(parsed).toBeInstanceOf(FeeBumpTransaction);
    expect(parsed.signatures.length).toBe(1);
  });

  it("rejects malformed inner envelopes before building the fee bump transaction", async () => {
    const res = await request(buildApp(Keypair.random()))
      .post("/stellar/tx/feebump")
      .send({ innerEnvelope: "not-xdr", bumpFee: "500" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      code: "malformed_inner",
    });
  });

  it("rejects bump fees above the configured cap", async () => {
    const res = await request(buildApp(Keypair.random(), "100"))
      .post("/stellar/tx/feebump")
      .send({ innerEnvelope: buildSignedInner(), bumpFee: "101" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      ok: false,
      code: "fee_cap_exceeded",
    });
  });
});

