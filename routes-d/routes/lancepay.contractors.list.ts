import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractorRecord = {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  country: string;
  contractType: string;
  lastActivityAt: string;
  createdAt: string;
};

const contractors = new Map<string, ContractorRecord>();

/**
 * GET /lancepay/contractors
 * List contractors belonging to the calling LancePay workspace.
 * Query params: status, country, contractType, page, limit
 */
router.get(
  "/lancepay/contractors",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, country, contractType, page = "1", limit = "20" } = req.query;

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

      let filtered = Array.from(contractors.values());

      if (status && typeof status === "string") {
        filtered = filtered.filter((c) => c.status === status.trim());
      }

      if (country && typeof country === "string") {
        filtered = filtered.filter((c) => c.country === country.trim());
      }

      if (contractType && typeof contractType === "string") {
        filtered = filtered.filter((c) => c.contractType === contractType.trim());
      }

      filtered.sort((a, b) => {
        const aTime = new Date(a.lastActivityAt).getTime();
        const bTime = new Date(b.lastActivityAt).getTime();
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
