import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const knownAccounts = new Set<string>();

export function __resetInflation(): void {
  knownAccounts.clear();
}

export function __addKnownAccount(accountId: string): void {
  knownAccounts.add(accountId);
}

type InflationBody = {
  sourceAccount: string;
  destination: string;
};

function isValidStellarAccountId(id: string): boolean {
  return typeof id === "string" && id.length === 56 && id.startsWith("G");
}

router.post("/stellar/account/inflation", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as InflationBody;

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
      sendError(res, "SELF_DESTINATION", "Inflation destination cannot be the same as source account", 400);
      return;
    }

    if (!knownAccounts.has(body.destination)) {
      sendError(res, "DESTINATION_NOT_FOUND", "Destination account does not exist on the network", 404);
      return;
    }

    const unsignedEnvelope = `unsigned_inflation_envelope_${body.sourceAccount}_${body.destination}`;

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
