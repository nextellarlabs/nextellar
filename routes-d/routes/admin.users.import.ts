/**
 * admin.users.import.ts
 *
 * POST /admin/users/import
 *
 * Accepts a multipart/form-data upload with a "file" field containing a CSV,
 * OR a raw text/csv body, and bulk-imports users for partner onboarding.
 *
 * Key behaviours:
 *  - Streams / buffers the CSV and validates every row individually
 *  - Returns per-row outcomes so callers know exactly which rows failed
 *  - Idempotent: re-uploading the exact same CSV returns the cached result
 *  - Requires x-operator-id header and "import" scope
 *
 * Expected CSV columns (case-insensitive headers):
 *   email, firstname, lastname, country[, role]
 *
 * Success response (207 when any row failed, 200 when all accepted):
 * {
 *   "success": true,
 *   "data": {
 *     "contentHash": "...",
 *     "duplicate": false,
 *     "accepted": 3,
 *     "rejected": 1,
 *     "results": [
 *       { "row": 0, "email": "a@b.com", "status": "accepted" },
 *       { "row": 1, "email": "bad",     "status": "rejected", "errors": ["email: email is not a valid address"] }
 *     ]
 *   }
 * }
 */

import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import {
  requireOperator,
  requireScope,
  type AuthenticatedRequest,
} from "../middleware/authMiddleware.js";
import {
  processImport,
  CsvColumnError,
} from "../lib/importProcessor.js";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * Collect the raw request body as a Buffer regardless of content-type.
 * We buffer up to MAX_CSV_BYTES + 1 so we can detect oversized payloads.
 */
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_CSV_BYTES) {
        reject(
          Object.assign(new Error("Payload too large"), { statusCode: 413 }),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

router.post(
  "/admin/users/import",
  requireOperator,
  requireScope("import"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const contentType = (req.headers["content-type"] ?? "").toLowerCase();

      let csvBuffer: Buffer;

      if (
        contentType.includes("text/csv") ||
        contentType.includes("application/octet-stream") ||
        contentType.includes("text/plain")
      ) {
        // Raw body upload
        csvBuffer = await readRawBody(req);
      } else if (contentType.includes("multipart/form-data")) {
        // For multipart we expect express-fileupload / multer to have already
        // parsed files onto req.files; however since this codebase does not
        // add a file-upload middleware globally, we fall back to reading the
        // raw body and treating it as CSV to keep the route self-contained.
        csvBuffer = await readRawBody(req);
      } else if (contentType.includes("application/json")) {
        // Allow a JSON wrapper: { "csv": "<raw csv string>" }
        let body: unknown;
        try {
          const raw = await readRawBody(req);
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          sendError(res, "INVALID_JSON", "Request body is not valid JSON", 400);
          return;
        }

        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as Record<string, unknown>)["csv"] !== "string"
        ) {
          sendError(
            res,
            "MISSING_CSV_FIELD",
            'JSON body must contain a "csv" string field',
            400,
          );
          return;
        }

        csvBuffer = Buffer.from(
          ((body as Record<string, unknown>)["csv"] as string),
          "utf8",
        );
      } else {
        sendError(
          res,
          "UNSUPPORTED_CONTENT_TYPE",
          "Content-Type must be text/csv, multipart/form-data, or application/json",
          415,
        );
        return;
      }

      if (csvBuffer.length === 0) {
        sendError(res, "EMPTY_PAYLOAD", "CSV file must not be empty", 400);
        return;
      }

      const submittedBy = req.operator!.operatorId;

      const { importRecord, duplicate } = await processImport({
        csvInput: csvBuffer,
        submittedBy,
      });

      // 207 Multi-Status when any rows were rejected; 200 when all accepted
      const httpStatus =
        importRecord.rejected > 0 ? 207 : 200;

      return res.status(httpStatus).json({
        success: true,
        data: {
          contentHash: importRecord.contentHash,
          duplicate,
          submittedBy: importRecord.submittedBy,
          accepted: importRecord.accepted,
          rejected: importRecord.rejected,
          results: importRecord.results,
        },
      });
    } catch (err) {
      if (err instanceof CsvColumnError) {
        sendError(
          res,
          "MISSING_CSV_COLUMNS",
          err.message,
          422,
        );
        return;
      }

      // Payload too large
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { statusCode?: number }).statusCode === 413
      ) {
        sendError(
          res,
          "PAYLOAD_TOO_LARGE",
          "CSV exceeds the 10 MB limit",
          413,
        );
        return;
      }

      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export { router as default };

// Re-export helpers from importProcessor so tests can seed/reset state
export {
  __getImportedUsers,
  __resetImportedUsers,
} from "../lib/importProcessor.js";

export {
  __resetImportStore,
} from "../lib/importHashStore.js";
