// GET /orders/history — paginated order history scoped to the authenticated
// caller (#302).
//
// Identity is read via an injectable `getIdentity` function (default reads
// from req.jwt populated by the JWT middleware). Using query params for
// identity would expose user IDs in server logs; the injectable keeps tests
// clean without requiring real tokens.

import { Router, type Request, type Response } from 'express';
import type { OrderStatus } from '../lib/orderIndex.js';

export type { OrderStatus };

export interface OrderHistoryEntry {
  id: string;
  userId: string;
  status: OrderStatus;
  amount: number;
  createdAt: number;
}

export interface OrderHistoryPage {
  results: OrderHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface OrderHistoryStore {
  listByUser(userId: string, page: number, pageSize: number): Promise<OrderHistoryPage>;
}

export interface CallerIdentity {
  callerId: string;
}

export interface OrderHistoryRouterOptions {
  store: OrderHistoryStore;
  /**
   * Extract caller identity from the request. Return null to deny (401).
   * Defaults to reading `req.jwt.sub` (populated by requireJwt middleware).
   * Tests inject a stub that returns a fixed identity.
   */
  getIdentity?: (req: Request) => CallerIdentity | null;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePositiveInt(
  value: unknown,
  fallback: number,
): { value?: number; error?: string } {
  if (value === undefined) return { value: fallback };
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { error: `expected a positive integer, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

function defaultGetIdentity(req: Request): CallerIdentity | null {
  const sub = req.jwt?.sub;
  if (!sub) return null;
  return { callerId: sub };
}

export function createOrdersHistoryRouter(opts: OrderHistoryRouterOptions): Router {
  const router = Router();
  const getIdentity = opts.getIdentity ?? defaultGetIdentity;

  router.get('/history', async (req: Request, res: Response) => {
    const identity = getIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const page = parsePositiveInt(req.query['page'], DEFAULT_PAGE);
    if (page.error) {
      res.status(400).json({ ok: false, error: `page: ${page.error}` });
      return;
    }

    const pageSize = parsePositiveInt(req.query['pageSize'], DEFAULT_PAGE_SIZE);
    if (pageSize.error) {
      res.status(400).json({ ok: false, error: `pageSize: ${pageSize.error}` });
      return;
    }

    const resolvedPageSize = Math.min(pageSize.value!, MAX_PAGE_SIZE);

    const result = await opts.store.listByUser(
      identity.callerId,
      page.value!,
      resolvedPageSize,
    );

    res.status(200).json({ ok: true, ...result });
  });

  return router;
}
