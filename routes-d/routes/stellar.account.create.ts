// routes-d/routes/stellar.account.create.ts
// POST /stellar/account/create – creates a new Stellar account funded by a server‑owned sponsor key.

import { Router, type Request, type Response } from "express";
import { Server, Networks, TransactionBuilder, Operation, Memo, Keypair } from "@stellar/stellar-sdk";
import { validateCreateAccount } from "../middleware/validateCreateAccount.js";
import { getSponsorKeypair, getSponsorDailyCap } from "../lib/sponsorConfig.js";
import { sponsorshipTracker } from "../lib/sponsorshipTracker.js";

// Horizon server – default to testnet if not provided.
const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const server = new Server(HORIZON_URL);

// Default initial balance for new accounts (in XLM). Can be overridden via env.
const DEFAULT_INITIAL_BALANCE = process.env.SPONSOR_INITIAL_BALANCE ?? "2";

export const createAccountRouter = Router();

createAccountRouter.post("/stellar/account/create", validateCreateAccount, async (req: Request, res: Response) => {
  try {
    // Enforce per‑day sponsor cap.
    const dailyCap = getSponsorDailyCap();
    if (sponsorshipTracker.getCount() >= dailyCap) {
      return res.status(429).json({ ok: false, error: "Daily sponsorship cap exceeded" });
    }

    const sponsorKp = getSponsorKeypair();
    const sponsorPublic = sponsorKp.publicKey();

    // Load sponsor account details.
    const sponsorAccount = await server.loadAccount(sponsorPublic);

    // Retrieve validated payload.
    const payload: any = (req as any).validatedCreateAccount as {
      destination?: string;
      memo?: string;
      initialBalance?: string;
    };

    // Determine destination – either provided or a fresh random keypair.
    const destinationKeypair = payload.destination ? Keypair.fromPublicKey(payload.destination) : Keypair.random();
    const destinationPublic = destinationKeypair.publicKey();
    const initialBalance = payload.initialBalance ?? DEFAULT_INITIAL_BALANCE;

    // Build transaction.
    const tx = new TransactionBuilder(sponsorAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.createAccount({
        destination: destinationPublic,
        startingBalance: initialBalance,
      }))
      .setTimeout(30);

    if (payload.memo) {
      tx.addMemo(Memo.text(payload.memo));
    }

    const transaction = tx.build();
    transaction.sign(sponsorKp);

    // Submit transaction.
    await server.submitTransaction(transaction);

    // Increment sponsorship counter.
    sponsorshipTracker.increment();

    // Return result – include the new account secret only if we generated it.
    const response: any = {
      ok: true,
      publicKey: destinationPublic,
    };
    if (!payload.destination) {
      response.secretKey = destinationKeypair.secret();
    }
    return res.status(201).json(response);
  } catch (err: any) {
    console.error("Account creation error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Internal server error" });
  }
});
