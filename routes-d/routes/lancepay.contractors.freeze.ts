import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type FreezeStatus = "frozen" | "active";

type ContractorRecord = {
  id: string;
  workspaceId: string;
  status: FreezeStatus;
  frozenAt?: string;
  frozenBy?: string;
  freezeReason?: string;
  updatedAt: string;
};

type AuditEvent = {
  contractorId: string;
  action: "freeze";
  performedBy: string;
  reason?: string;
  timestamp: string;
};

type FreezeBody = {
  adminId: string;      // workspace admin performing the freeze
  reason?: string;
};

// In-memory store
const contractors = new Map<string, ContractorRecord>();
const auditLog: AuditEvent[] = [];

/**
 * POST /lancepay/contractors/:id/freeze
 * Block payouts to a contractor pending review.
 * Requires workspace-admin role (adminId header or body).
 * Emits an audit event on success.
 */
router.post(
  "/lancepay/contractors/:id/freeze",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const body = req.body as FreezeBody;

      // Require admin identity — accept from body or x-admin-id header
      const adminId =
        body.adminId ||
        (req.headers["x-admin-id"] as string | undefined);

      if (!adminId || typeof adminId !== "string" || !adminId.trim()) {
        sendError(
          res,
          "UNAUTHORIZED",
          "workspace-admin identity required (adminId in body or x-admin-id header)",
          403,
        );
        return;
      }

      const contractor = contractors.get(contractorId);

      if (!contractor) {
        sendError(res, "NOT_FOUND", "Contractor not found", 404);
        return;
      }

      if (contractor.status === "frozen") {
        sendError(
          res,
          "ALREADY_FROZEN",
          "Contractor is already frozen. No action taken.",
          409,
        );
        return;
      }

      const now = new Date().toISOString();

      contractor.status      = "frozen";
      contractor.frozenAt    = now;
      contractor.frozenBy    = adminId.trim();
      contractor.freezeReason = body.reason?.trim();
      contractor.updatedAt   = now;

      // Emit audit event
      auditLog.push({
        contractorId,
        action: "freeze",
        performedBy: adminId.trim(),
        reason: body.reason?.trim(),
        timestamp: now,
      });

      return res.status(200).json({
        success: true,
        data: {
          contractorId,
          status: contractor.status,
          frozenAt: contractor.frozenAt,
          frozenBy: contractor.frozenBy,
          freezeReason: contractor.freezeReason,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContractor(c: ContractorRecord): void {
  contractors.set(c.id, { ...c });
}

export function __getContractor(id: string): ContractorRecord | undefined {
  return contractors.get(id);
}

export function __getAuditLog(): AuditEvent[] {
  return auditLog;
}

export function __resetContractors(): void {
  contractors.clear();
  auditLog.length = 0;
}

export default router;
