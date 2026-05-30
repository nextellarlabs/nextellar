import { Router, Request, Response, NextFunction } from "express";
import {
  balanceCache,
  type BalanceEntry,
  type BalanceFetcher,
} from "../lib/balanceCache.js";

const HORIZON_BASE =
  process.env.NEXTELLAR_HORIZON_URL?.trim() || "https://horizon.stellar.org";

const STELLAR_ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/;

const defaultFetcher: BalanceFetcher = async (accountId) => {
  const url = `${HORIZON_BASE.replace(/\/$/, "")}/accounts/${encodeURIComponent(
    accountId,
  )}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`horizon_account_lookup_failed_${response.status}`);
  }
  const payload = (await response.json()) as { balances?: BalanceEntry[] };
  return payload.balances ?? [];
};

interface BalanceRouterOptions {
  fetcher?: BalanceFetcher;
}

export function createStellarBalanceRouter(
  options: BalanceRouterOptions = {},
): Router {
  const router = Router();
  const fetcher = options.fetcher ?? defaultFetcher;

  router.get(
    "/stellar/balance/:accountId",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const accountId = req.params.accountId?.trim();
        if (!accountId || !STELLAR_ACCOUNT_PATTERN.test(accountId)) {
          return res.status(400).json({ error: "invalid_account_id" });
        }

        const forceRefresh =
          typeof req.query.refresh === "string" &&
          ["1", "true", "yes"].includes(req.query.refresh.toLowerCase());

        const { value, fromCache } = await balanceCache.get(
          accountId,
          fetcher,
          { forceRefresh },
        );

        return res.status(200).json({
          success: true,
          data: {
            accountId: value.accountId,
            balances: value.balances,
            fetchedAt: value.fetchedAt,
            expiresAt: value.expiresAt,
            fromCache,
          },
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    "/stellar/balance/:accountId/invalidate",
    (req: Request, res: Response) => {
      const accountId = req.params.accountId?.trim();
      if (!accountId || !STELLAR_ACCOUNT_PATTERN.test(accountId)) {
        return res.status(400).json({ error: "invalid_account_id" });
      }
      const removed = balanceCache.invalidate(accountId);
      return res.status(200).json({
        success: true,
        data: { accountId, removed },
      });
    },
  );

  // Webhook-style endpoint: an outgoing payment from `from` invalidates that
  // account's cached balances so subsequent reads observe the new ledger state.
  router.post(
    "/stellar/balance/invalidate-on-payment",
    (req: Request, res: Response) => {
      const from =
        typeof req.body?.from === "string" ? req.body.from.trim() : "";
      if (!from || !STELLAR_ACCOUNT_PATTERN.test(from)) {
        return res.status(400).json({ error: "invalid_from_account" });
      }
      const removed = balanceCache.invalidate(from);
      return res.status(200).json({
        success: true,
        data: { from, removed },
      });
    },
  );

  return router;
}

export default createStellarBalanceRouter();
