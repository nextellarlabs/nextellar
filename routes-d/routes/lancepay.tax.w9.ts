import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const ENCRYPTION_KEY_ID = "lancepay-w9-v1";

type W9Submission = {
  contractorId: string;
  legalName: string;
  tin: string;
  signatureName: string;
  signatureTimestamp: string;
  encryptedFields: {
    legalName: string;
    tin: string;
    signatureName: string;
  };
  submittedAt: string;
};

const submissions: W9Submission[] = [];

function isValidTin(value: string): boolean {
  return /^\d{9}$/.test(value.trim());
}

function isValidTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function encryptValue(value: string): string {
  return `${ENCRYPTION_KEY_ID}:${Buffer.from(value).toString("base64")}`;
}

router.post(
  "/lancepay/tax-forms/w9",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = String(req.body?.contractorId ?? "").trim();
      const legalName = String(req.body?.legalName ?? "").trim();
      const tin = String(req.body?.tin ?? "").trim();
      const signatureName = String(req.body?.signatureName ?? "").trim();
      const signatureTimestamp = String(req.body?.signatureTimestamp ?? "").trim();
      const callerId = String(req.headers["x-caller-id"] ?? "").trim();

      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      if (!legalName) {
        sendError(res, "INVALID_LEGAL_NAME", "legalName is required", 400);
        return;
      }

      if (!isValidTin(tin)) {
        sendError(res, "INVALID_TIN", "TIN must be a 9-digit number", 400);
        return;
      }

      if (!signatureName) {
        sendError(res, "INVALID_SIGNATURE_NAME", "signatureName is required", 400);
        return;
      }

      if (!isValidTimestamp(signatureTimestamp)) {
        sendError(res, "INVALID_SIGNATURE_TIMESTAMP", "signatureTimestamp must be a valid ISO-8601 date", 400);
        return;
      }

      if (!callerId || callerId !== contractorId) {
        sendError(res, "FORBIDDEN", "Only the contractor can submit their own W-9", 403);
        return;
      }

      const submission: W9Submission = {
        contractorId,
        legalName,
        tin,
        signatureName,
        signatureTimestamp,
        encryptedFields: {
          legalName: encryptValue(legalName),
          tin: encryptValue(tin),
          signatureName: encryptValue(signatureName),
        },
        submittedAt: new Date().toISOString(),
      };

      submissions.push(submission);

      return res.status(200).json({
        success: true,
        data: {
          contractorId: submission.contractorId,
          submittedAt: submission.submittedAt,
          keyId: ENCRYPTION_KEY_ID,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

export function __getSubmittedForms(): W9Submission[] {
  return submissions.map((submission) => ({ ...submission, encryptedFields: { ...submission.encryptedFields } }));
}

export function __resetSubmittedForms(): void {
  submissions.length = 0;
}

export default router;
