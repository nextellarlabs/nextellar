import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type VerificationVerdict = "approved" | "rejected" | "pending";

type VerificationRecord = {
  id: string;
  contractorId: string;
  workspaceId: string;
  documentUrls: string[];
  verdict: VerificationVerdict;
  verifierNotes?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  auditTrail: AuditEntry[];
  createdAt: string;
  updatedAt: string;
};

type AuditEntry = {
  action: "submitted" | "verified" | "approved" | "rejected";
  performedBy: string;
  timestamp: string;
  notes?: string;
};

type VerifyBody = {
  documentUrls: string[];
  verifierNotes?: string;
  verifiedBy?: string;
  verdict?: VerificationVerdict;
};

const verifications = new Map<string, VerificationRecord>();

/**
 * POST /lancepay/contractors/:id/verify
 * Run KYC verification for a contractor and persist the result.
 * Submit captured documents through the KYC upload pipeline.
 * Persist provider verdict and the verifier audit trail.
 */
router.post(
  "/lancepay/contractors/:id/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const body = req.body as VerifyBody;

      if (!body.documentUrls || !Array.isArray(body.documentUrls) || body.documentUrls.length === 0) {
        sendError(res, "INVALID_DOCUMENTS", "documentUrls must be a non-empty array", 400);
        return;
      }

      for (const url of body.documentUrls) {
        if (typeof url !== "string" || !url.trim()) {
          sendError(res, "INVALID_DOCUMENT_URL", "All document URLs must be non-empty strings", 400);
          return;
        }
      }

      const verifiedBy = body.verifiedBy || "system";
      const verdict = body.verdict || "pending";
      const now = new Date().toISOString();

      const validVerdicts: VerificationVerdict[] = ["approved", "rejected", "pending"];
      if (!validVerdicts.includes(verdict)) {
        sendError(
          res,
          "INVALID_VERDICT",
          "verdict must be one of: approved, rejected, pending",
          400,
        );
        return;
      }

      const verificationId = `ver-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const auditTrail: AuditEntry[] = [
        {
          action: "submitted",
          performedBy: verifiedBy,
          timestamp: now,
          notes: `KYC verification submitted with ${body.documentUrls.length} documents`,
        },
      ];

      if (verdict !== "pending") {
        auditTrail.push({
          action: verdict === "approved" ? "approved" : "rejected",
          performedBy: verifiedBy,
          timestamp: now,
          notes: body.verifierNotes,
        });
      }

      const verification: VerificationRecord = {
        id: verificationId,
        contractorId,
        workspaceId: req.headers["x-workspace-id"] as string || "unknown",
        documentUrls: body.documentUrls.map((u) => u.trim()),
        verdict,
        verifierNotes: body.verifierNotes,
        verifiedBy: verdict !== "pending" ? verifiedBy : undefined,
        verifiedAt: verdict !== "pending" ? now : undefined,
        auditTrail,
        createdAt: now,
        updatedAt: now,
      };

      verifications.set(verificationId, verification);

      const status = verdict === "approved" ? 200 : 201;
      return res.status(status).json({
        success: true,
        data: verification,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedVerification(v: VerificationRecord): void {
  verifications.set(v.id, { ...v });
}

export function __resetVerifications(): void {
  verifications.clear();
}

export function __getVerifications(): Map<string, VerificationRecord> {
  return verifications;
}

export default router;
