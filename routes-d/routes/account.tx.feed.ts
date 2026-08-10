import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Payment = {
  hash: string;
  amount: string;
  asset: string;
  source: string;
  destination: string;
  ledgerCloseTime: string;
};

type Trustline = {
  hash: string;
  assetCode: string;
  assetIssuer: string;
  limit: string;
  ledgerCloseTime: string;
};

type ContractEvent = {
  hash: string;
  contractId: string;
  topic: string;
  value: string;
  ledgerCloseTime: string;
};

type FeedItem =
  | ({ type: "payment" } & Payment)
  | ({ type: "trustline" } & Trustline)
  | ({ type: "contract_event" } & ContractEvent);

const paymentsStore = new Map<string, Payment[]>();
const trustlinesStore = new Map<string, Trustline[]>();
const contractEventsStore = new Map<string, ContractEvent[]>();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function buildFeed(userId: string): FeedItem[] {
  const payments: FeedItem[] = (paymentsStore.get(userId) ?? []).map((p) => ({ type: "payment", ...p }));
  const trustlines: FeedItem[] = (trustlinesStore.get(userId) ?? []).map((t) => ({ type: "trustline", ...t }));
  const events: FeedItem[] = (contractEventsStore.get(userId) ?? []).map((e) => ({ type: "contract_event", ...e }));

  const feed = [...payments, ...trustlines, ...events];
  feed.sort((a, b) => new Date(b.ledgerCloseTime).getTime() - new Date(a.ledgerCloseTime).getTime());
  return feed;
}

router.get(
  "/account/tx/feed",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const page =
        req.query.page !== undefined
          ? parseInt(req.query.page as string, 10)
          : DEFAULT_PAGE;
      const limit =
        req.query.limit !== undefined
          ? parseInt(req.query.limit as string, 10)
          : DEFAULT_LIMIT;

      if (
        isNaN(page) ||
        page < 1 ||
        isNaN(limit) ||
        limit < 1 ||
        limit > MAX_LIMIT
      ) {
        sendError(
          res,
          "INVALID_PAGINATION",
          "page must be >= 1 and limit must be between 1 and 100",
          400,
        );
        return;
      }

      const feed = buildFeed(userId);
      const total = feed.length;
      const offset = (page - 1) * limit;
      const paginated = feed.slice(offset, offset + limit);

      return res.status(200).json({
        success: true,
        data: paginated,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetFeed(): void {
  paymentsStore.clear();
  trustlinesStore.clear();
  contractEventsStore.clear();
}

export function __seedPayment(userId: string, payment: Payment): void {
  const existing = paymentsStore.get(userId) ?? [];
  existing.push(payment);
  paymentsStore.set(userId, existing);
}

export function __seedTrustline(userId: string, trustline: Trustline): void {
  const existing = trustlinesStore.get(userId) ?? [];
  existing.push(trustline);
  trustlinesStore.set(userId, existing);
}

export function __seedContractEvent(userId: string, event: ContractEvent): void {
  const existing = contractEventsStore.get(userId) ?? [];
  existing.push(event);
  contractEventsStore.set(userId, existing);
}

export default router;
