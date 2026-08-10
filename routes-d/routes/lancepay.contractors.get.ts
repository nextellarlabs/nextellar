import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractorRecord = {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  country: string;
  contractType: string;
  payoutStatus: string;
  complianceStatus: string;
  createdAt: string;
};

type ContractorResponse = {
  id: string;
  workspaceId: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  country: string;
  contractType: string;
  payoutStatus: string;
  complianceStatus: string;
  createdAt: string;
};

const contractors = new Map<string, ContractorRecord>();

/**
 * GET /lancepay/contractors/:id
 * Return a single contractor profile with payout, contract, and compliance status.
 * Restrict to members of the owning LancePay workspace.
 * Hide sensitive identifiers from non-admin roles.
 */
router.get(
  "/lancepay/contractors/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const contractor = contractors.get(contractorId);
      if (!contractor) {
        sendError(res, "NOT_FOUND", "Contractor not found", 404);
        return;
      }

      const callerWorkspaceId = req.headers["x-workspace-id"] as string | undefined;
      const callerRole = req.headers["x-role"] as string | undefined;

      if (!callerWorkspaceId) {
        sendError(res, "MISSING_WORKSPACE", "x-workspace-id header is required", 401);
        return;
      }

      if (contractor.workspaceId !== callerWorkspaceId) {
        sendError(
          res,
          "FORBIDDEN",
          "Access denied: you do not belong to this contractor's workspace",
          403,
        );
        return;
      }

      const isAdmin = callerRole === "admin";

      const response: ContractorResponse = {
        id: contractor.id,
        workspaceId: contractor.workspaceId,
        name: contractor.name,
        status: contractor.status,
        country: contractor.country,
        contractType: contractor.contractType,
        payoutStatus: contractor.payoutStatus,
        complianceStatus: contractor.complianceStatus,
        createdAt: contractor.createdAt,
      };

      if (isAdmin) {
        response.email = contractor.email;
        response.phone = contractor.phone;
      }

      return res.status(200).json({
        success: true,
        data: response,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContractor(c: ContractorRecord): void {
  contractors.set(c.id, { ...c });
}

export function __resetContractors(): void {
  contractors.clear();
}

export function __getContractors(): Map<string, ContractorRecord> {
  return contractors;
}

export default router;
