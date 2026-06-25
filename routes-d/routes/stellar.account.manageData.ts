import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const MAX_DATA_KEY_BYTES = 64;
const MAX_DATA_VALUE_BYTES = 64;

type ManageDataBody = {
  sourceAccount: string;
  dataKey: string;
  dataValue?: string | null;
};

function isValidStellarAccountId(id: string): boolean {
  return typeof id === "string" && id.length === 56 && id.startsWith("G");
}

export function __resetManageData(): void {}

router.post("/stellar/account/manage-data", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as ManageDataBody;

    if (!body.sourceAccount || !body.dataKey) {
      sendError(res, "MISSING_FIELDS", "sourceAccount and dataKey are required", 400);
      return;
    }

    if (!isValidStellarAccountId(body.sourceAccount)) {
      sendError(res, "INVALID_SOURCE_ACCOUNT", "sourceAccount is not a valid Stellar account ID", 400);
      return;
    }

    if (Buffer.byteLength(body.dataKey, "utf8") > MAX_DATA_KEY_BYTES) {
      sendError(res, "KEY_TOO_LONG", "dataKey exceeds the 64-byte limit", 400);
      return;
    }

    if (body.dataValue != null) {
      if (Buffer.from(body.dataValue, "base64").length > MAX_DATA_VALUE_BYTES) {
        sendError(res, "VALUE_TOO_LARGE", "dataValue decoded bytes exceed the 64-byte limit", 400);
        return;
      }
    }

    const operation = body.dataValue != null ? "set" : "clear";
    const unsignedEnvelope = `unsigned_manage_data_envelope_${body.sourceAccount}_${body.dataKey}_${operation}`;

    return res.status(200).json({
      success: true,
      data: {
        sourceAccount: body.sourceAccount,
        operation,
        dataKey: body.dataKey,
        unsignedEnvelope,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
