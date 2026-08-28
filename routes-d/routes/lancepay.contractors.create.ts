import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const VALID_CONTRACT_TYPES = new Set(["fixed", "hourly", "milestone"]);

type ContractorRecord = {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  taxId: string;
  payoutWallet: string;
  homeJurisdiction: string;
  contractType: string;
  status: string;
  createdAt: string;
};

type CreateContractorBody = {
  name: string;
  email: string;
  taxId: string;
  payoutWallet: string;
  homeJurisdiction: string;
  contractType: string;
};

// In-memory store
const contractors = new Map<string, ContractorRecord>();
const emailIndex = new Map<string, string>(); // email+workspaceId -> contractorId

/**
 * POST /lancepay/contractors
 * Create a contractor profile under the calling workspace owner.
 * Validates identity fields, payout wallet, and home jurisdiction.
 * Rejects duplicate email within the same workspace.
 */
router.post(
  "/lancepay/contractors",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.headers["x-workspace-id"] as string | undefined;
      if (!workspaceId) {
        sendError(res, "MISSING_WORKSPACE", "x-workspace-id header is required", 401);
        return;
      }

      const body = req.body as CreateContractorBody;

      if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
        sendError(res, "INVALID_NAME", "name is required", 400);
        return;
      }

      if (!body.email || typeof body.email !== "string") {
        sendError(res, "INVALID_EMAIL", "email is required", 400);
        return;
      }

      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendError(res, "INVALID_EMAIL", "email must be a valid email address", 400);
        return;
      }

      if (!body.taxId || typeof body.taxId !== "string" || !body.taxId.trim()) {
        sendError(res, "INVALID_TAX_ID", "taxId is required", 400);
        return;
      }

      if (!body.payoutWallet || typeof body.payoutWallet !== "string") {
        sendError(res, "INVALID_PAYOUT_WALLET", "payoutWallet is required", 400);
        return;
      }

      const wallet = body.payoutWallet.trim();
      if (!/^G[A-Z2-7]{55}$/.test(wallet)) {
        sendError(
          res,
          "INVALID_PAYOUT_WALLET",
          "payoutWallet must be a valid Stellar public key (G...)",
          400,
        );
        return;
      }

      if (
        !body.homeJurisdiction ||
        typeof body.homeJurisdiction !== "string" ||
        !body.homeJurisdiction.trim()
      ) {
        sendError(res, "INVALID_HOME_JURISDICTION", "homeJurisdiction is required", 400);
        return;
      }

      if (!body.contractType || typeof body.contractType !== "string") {
        sendError(res, "INVALID_CONTRACT_TYPE", "contractType is required", 400);
        return;
      }

      const contractType = body.contractType.trim().toLowerCase();
      if (!VALID_CONTRACT_TYPES.has(contractType)) {
        sendError(
          res,
          "INVALID_CONTRACT_TYPE",
          `contractType must be one of: ${[...VALID_CONTRACT_TYPES].join(", ")}`,
          400,
        );
        return;
      }

      // Duplicate check within workspace
      const dupKey = `${workspaceId}:${email}`;
      if (emailIndex.has(dupKey)) {
        sendError(
          res,
          "DUPLICATE_IDENTIFIER",
          "A contractor with this email already exists in the workspace",
          409,
        );
        return;
      }

      const id = `con-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const contractor: ContractorRecord = {
        id,
        workspaceId,
        name: body.name.trim(),
        email,
        taxId: body.taxId.trim(),
        payoutWallet: wallet,
        homeJurisdiction: body.homeJurisdiction.trim(),
        contractType,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      contractors.set(id, contractor);
      emailIndex.set(dupKey, id);

      return res.status(201).json({ success: true, data: contractor });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContractor(c: ContractorRecord): void {
  contractors.set(c.id, { ...c });
  emailIndex.set(`${c.workspaceId}:${c.email}`, c.id);
}

export function __resetContractors(): void {
  contractors.clear();
  emailIndex.clear();
}

export function __getContractors(): Map<string, ContractorRecord> {
  return contractors;
}

export default router;
