import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type SetOptionsBody = {
  sourceAccount: string;
  setFlags?: {
    authRequired?: boolean;
    authRevocable?: boolean;
    authImmutable?: boolean;
  };
  clearFlags?: {
    authRequired?: boolean;
    authRevocable?: boolean;
    authImmutable?: boolean;
  };
  thresholds?: {
    low?: number;
    medium?: number;
    high?: number;
  };
  homeDomain?: string;
};

function isValidStellarAccountId(id: string): boolean {
  return typeof id === "string" && id.length === 56 && id.startsWith("G");
}

function isValidThreshold(value: number): boolean {
  return typeof value === "number" && value >= 0 && value <= 255 && Number.isInteger(value);
}

function validateThresholdOrdering(low?: number, medium?: number, high?: number): boolean {
  if (low != null && medium != null && low > medium) {
    return false;
  }
  if (medium != null && high != null && medium > high) {
    return false;
  }
  if (low != null && high != null && low > high) {
    return false;
  }
  return true;
}

function isValidHomeDomain(domain: string): boolean {
  if (typeof domain !== "string") {
    return false;
  }
  // Home domain max length is 32 bytes
  return Buffer.byteLength(domain, "utf8") <= 32;
}

export function __resetSetOptions(): void {}

router.post("/stellar/account/set-options", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as SetOptionsBody;

    if (!body.sourceAccount) {
      sendError(res, "MISSING_FIELDS", "sourceAccount is required", 400);
      return;
    }

    if (!isValidStellarAccountId(body.sourceAccount)) {
      sendError(res, "INVALID_SOURCE_ACCOUNT", "sourceAccount is not a valid Stellar account ID", 400);
      return;
    }

    // Validate thresholds if provided
    if (body.thresholds) {
      const { low, medium, high } = body.thresholds;

      if (low != null && !isValidThreshold(low)) {
        sendError(res, "INVALID_THRESHOLD", "low threshold must be an integer between 0 and 255", 400);
        return;
      }

      if (medium != null && !isValidThreshold(medium)) {
        sendError(res, "INVALID_THRESHOLD", "medium threshold must be an integer between 0 and 255", 400);
        return;
      }

      if (high != null && !isValidThreshold(high)) {
        sendError(res, "INVALID_THRESHOLD", "high threshold must be an integer between 0 and 255", 400);
        return;
      }

      // Validate threshold ordering: low <= medium <= high
      if (!validateThresholdOrdering(low, medium, high)) {
        sendError(res, "INVALID_THRESHOLD_ORDER", "Thresholds must be in non-decreasing order: low <= medium <= high", 400);
        return;
      }
    }

    // Validate home domain if provided
    if (body.homeDomain != null && !isValidHomeDomain(body.homeDomain)) {
      sendError(res, "INVALID_HOME_DOMAIN", "homeDomain must be a string of at most 32 bytes", 400);
      return;
    }

    // Build operation summary for the envelope
    const operations: string[] = [];
    
    if (body.setFlags) {
      const flags = Object.entries(body.setFlags)
        .filter(([_, value]) => value === true)
        .map(([key]) => key);
      if (flags.length > 0) {
        operations.push(`setFlags:${flags.join(",")}`);
      }
    }

    if (body.clearFlags) {
      const flags = Object.entries(body.clearFlags)
        .filter(([_, value]) => value === true)
        .map(([key]) => key);
      if (flags.length > 0) {
        operations.push(`clearFlags:${flags.join(",")}`);
      }
    }

    if (body.thresholds) {
      const { low, medium, high } = body.thresholds;
      const thresholdParts = [];
      if (low != null) thresholdParts.push(`low:${low}`);
      if (medium != null) thresholdParts.push(`medium:${medium}`);
      if (high != null) thresholdParts.push(`high:${high}`);
      if (thresholdParts.length > 0) {
        operations.push(`thresholds:${thresholdParts.join(",")}`);
      }
    }

    if (body.homeDomain != null) {
      operations.push(`homeDomain:${body.homeDomain}`);
    }

    const operationSummary = operations.length > 0 ? operations.join(";") : "noChanges";
    const unsignedEnvelope = `unsigned_set_options_envelope_${body.sourceAccount}_${operationSummary}`;

    return res.status(200).json({
      success: true,
      data: {
        sourceAccount: body.sourceAccount,
        setFlags: body.setFlags,
        clearFlags: body.clearFlags,
        thresholds: body.thresholds,
        homeDomain: body.homeDomain,
        unsignedEnvelope,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
