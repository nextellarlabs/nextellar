import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractRecord = {
  id: string;
  workspaceId: string;
  contractorId: string;
  status: string;
  currency: string;
  rate: number;
  scope: string;
  startDate: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
};

const contracts = new Map<string, ContractRecord>();

function requestedWorkspaceId(req: Request): string | undefined {
  const header = req.header("x-lancepay-workspace-id") ?? req.header("x-workspace-id");
  if (header?.trim()) return header.trim();

  const queryWorkspaceId = req.query.workspaceId;
  if (typeof queryWorkspaceId === "string" && queryWorkspaceId.trim()) {
    return queryWorkspaceId.trim();
  }

  return undefined;
}

/**
 * GET /lancepay/contracts
 * List contracts for the calling LancePay workspace.
 * Query params: contractor, status, currency, page, limit
 */
router.get(
  "/lancepay/contracts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contractor, status, currency, page = "1", limit = "20" } = req.query;

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);

      if (isNaN(pageNum) || pageNum < 1) {
        sendError(res, "INVALID_PAGE", "page must be a positive integer", 400);
        return;
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, "INVALID_LIMIT", "limit must be between 1 and 100", 400);
        return;
      }

      const workspaceId = requestedWorkspaceId(req);
      let filtered = Array.from(contracts.values());

      if (workspaceId) {
        filtered = filtered.filter((contract) => contract.workspaceId === workspaceId);
      }

      if (contractor && typeof contractor === "string") {
        filtered = filtered.filter((contract) => contract.contractorId === contractor.trim());
      }

      if (status && typeof status === "string") {
        filtered = filtered.filter((contract) => contract.status === status.trim());
      }

      if (currency && typeof currency === "string") {
        const normalizedCurrency = currency.trim().toUpperCase();
        filtered = filtered.filter((contract) => contract.currency.toUpperCase() === normalizedCurrency);
      }

      filtered.sort((a, b) => {
        const aTime = new Date(a.startDate).getTime();
        const bTime = new Date(b.startDate).getTime();
        return bTime - aTime;
      });

      const offset = (pageNum - 1) * limitNum;
      const paged = filtered.slice(offset, offset + limitNum);

      return res.status(200).json({
        success: true,
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: filtered.length,
          hasNext: offset + limitNum < filtered.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContract(contract: ContractRecord): void {
  contracts.set(contract.id, { ...contract });
}

export function __resetContracts(): void {
  contracts.clear();
}

export function __getContracts(): Map<string, ContractRecord> {
  return contracts;
}

export default router;