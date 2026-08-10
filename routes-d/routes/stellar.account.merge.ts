import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type AccountConstraints = { hasTrustlines: boolean; hasOpenOffers: boolean };
const accountConstraints = new Map<string, AccountConstraints>();
const knownAccounts = new Set<string>();

export function __resetMerge(): void {
  accountConstraints.clear();
  knownAccounts.clear();
}

export function __addAccount(accountId: string, constraints: AccountConstraints): void {
  knownAccounts.add(accountId);
  accountConstraints.set(accountId, constraints);
}

type MergeBody = { sourceAccount: string; destination: string };

function isValidStellarAccountId(id: string): boolean {
  return typeof id === "string" && id.length === 56 && id.startsWith("G");
}

router.post("/stellar/account/merge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as MergeBody;

    if (!body.sourceAccount || !body.destination) {
      sendError(res, "MISSING_FIELDS", "sourceAccount and destination are required", 400);
      return;
    }

    if (!isValidStellarAccountId(body.sourceAccount)) {
      sendError(res, "INVALID_SOURCE_ACCOUNT", "sourceAccount is not a valid Stellar account ID", 400);
      return;
    }

    if (!isValidStellarAccountId(body.destination)) {
      sendError(res, "INVALID_DESTINATION", "destination is not a valid Stellar account ID", 400);
      return;
    }

    if (body.sourceAccount === body.destination) {
      sendError(res, "SELF_MERGE", "Source and destination accounts cannot be the same", 400);
      return;
    }

    if (!knownAccounts.has(body.sourceAccount)) {
      sendError(res, "ACCOUNT_NOT_FOUND", "Source account does not exist on the network", 404);
      return;
    }

    if (!knownAccounts.has(body.destination)) {
      sendError(res, "DESTINATION_NOT_FOUND", "Destination account does not exist on the network", 404);
      return;
    }

    const constraints = accountConstraints.get(body.sourceAccount);

    if (constraints?.hasTrustlines) {
      sendError(res, "HAS_TRUSTLINES", "Source account has active trustlines and cannot be merged", 409);
      return;
    }

    if (constraints?.hasOpenOffers) {
      sendError(res, "HAS_OPEN_OFFERS", "Source account has open offers and cannot be merged", 409);
      return;
    }

    const unsignedEnvelope = `unsigned_merge_envelope_${body.sourceAccount}_${body.destination}`;

    return res.status(200).json({
      success: true,
      data: {
        sourceAccount: body.sourceAccount,
        destination: body.destination,
        unsignedEnvelope,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
