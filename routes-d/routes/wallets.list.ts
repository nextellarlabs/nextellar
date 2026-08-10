import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Wallet = {
  id: string;
  address: string;
  label: string;
  isDefault: boolean;
  createdAt: string;
};

const walletStore = new Map<string, Wallet[]>();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export function __seedWallets(userId: string, wallets: Wallet[]): void {
  walletStore.set(userId, wallets);
}

export function __resetWalletStore(): void {
  walletStore.clear();
}

router.get("/wallets", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string | undefined;

    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const page = req.query.page !== undefined ? parseInt(req.query.page as string, 10) : DEFAULT_PAGE;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : DEFAULT_LIMIT;

    if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(res, "INVALID_PAGINATION", "page must be >= 1 and limit must be between 1 and 100", 400);
      return;
    }

    const userWallets = walletStore.get(userId) ?? [];

    const offset = (page - 1) * limit;
    const paginated = userWallets.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total: userWallets.length,
        totalPages: Math.ceil(userWallets.length / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
