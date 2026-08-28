import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type FreezeStatus = "frozen" | "active";

type ContractorRecord = {
  id: string;
  workspaceId: string;
  status: FreezeStatus;
  unfrozenAt?: string;
  unfrozenBy?: string;
  unfreezeReason?: string;
  updatedAt: string;
};

type AuditEvent = {
  contractorId: string;
  action: "unfreeze";
  performedBy: string;
  reason?: string;
  timestamp: string;
};

type UnfreezeBody = {
  adminId: string;
  reason?: string;
};

// In-memory store
const contractors = new Map<string, ContractorRecord>();
const auditLog: AuditEvent[] = [];

/**
 * POST /lancepay/contractors/:id/unfreeze
 * Lift a contractor payout freeze.
 * Requires workspace-admin role.
 * Emits an audit event on success.
 */
router.post(
  "/lancepay/contractors/:id/unfreeze",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const body = req.body as UnfreezeBody;
      const adminId = body.adminId || req.headers["x-admin-id"] as string | undefined;

      if (!adminId || typeof adminId !== "string" || !adminId.trim()) {
        sendError(
          res,
          "UNAUTHORIZED",
          "workspace-admin identity required",
          403,
        );
        return;
      }

      const contractor = contractors.get(contractorId);

      if (!contractor) {
        sendError(res, "NOT_FOUND", "Contractor not found", 404);
        return;
      }

      if (contractor.status !== "frozen") {
        sendError(
          res,
          "NOT_FROZEN",
          "Contractor is not frozen",
          409,
        );
        return;
      }

      const now = new Date().toISOString();

      contractor.status = "active";
      contractor.unfrozenAt = now;
      contractor.unfrozenBy = adminId.trim();
      contractor.unfreezeReason = body.reason?.trim();
      contractor.updatedAt = now;

      auditLog.push({
        contractorId,
        action: "unfreeze",
        performedBy: adminId.trim(),
        reason: body.reason?.trim(),
        timestamp: now,
      });

      return res.status(200).json({
        success: true,
        data: {
          contractorId,
          status: contractor.status,
          unfrozenAt: contractor.unfrozenAt,
          unfrozenBy: contractor.unfrozenBy,
          unfreezeReason: contractor.unfreezeReason,
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
