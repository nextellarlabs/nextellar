/**
 * Admin quota management routes.
 *
 * These endpoints expose read and write access to the in-memory quota store
 * so operators can inspect consumption, override policies, and force resets
 * without restarting the server.
 *
 * All routes expect an `x-operator-id` header for audit purposes; in
 * production this should be backed by a real auth check.
 *
 * Routes:
 *   GET  /admin/quota              — list all tracked keys
 *   GET  /admin/quota/:key         — get quota status for a single key
 *   POST /admin/quota/:key/reset   — reset the quota window for a key
 *   PUT  /admin/quota/:key/policy  — set a custom policy for a key
 *   DELETE /admin/quota/:key       — delete all quota state for a key
 */

import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';
import {
  getBucket,
  getAllBuckets,
  resetQuota,
  setPolicy,
  deleteKey,
  getPolicy,
  type QuotaPolicy,
} from '../lib/quotaStore.js';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireOperator(req: Request, res: Response): string | null {
  const operatorId = (req.headers['x-operator-id'] as string | undefined)?.trim();
  if (!operatorId) {
    sendError(res, 'UNAUTHORIZED', 'x-operator-id header is required', 401);
    return null;
  }
  return operatorId;
}

function formatBucket(bucket: ReturnType<typeof getBucket>) {
  return {
    key: bucket.key,
    limit: bucket.limit,
    remaining: bucket.remaining,
    windowMs: bucket.windowMs,
    windowStart: new Date(bucket.windowStart).toISOString(),
    resetAt: new Date(bucket.resetAt).toISOString(),
    resetAtEpochMs: bucket.resetAt,
  };
}

// ─── GET /admin/quota ─────────────────────────────────────────────────────────

/**
 * List quota status for all tracked API keys.
 */
router.get(
  '/admin/quota',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const buckets = getAllBuckets();
      return res.status(200).json({
        success: true,
        data: buckets.map(formatBucket),
        total: buckets.length,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ─── GET /admin/quota/:key ────────────────────────────────────────────────────

/**
 * Get quota status for a specific API key.
 */
router.get(
  '/admin/quota/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.params['key']?.trim();
      if (!apiKey) {
        sendError(res, 'INVALID_KEY', 'API key parameter is required', 400);
        return;
      }

      const bucket = getBucket(apiKey);
      const policy = getPolicy(apiKey);

      return res.status(200).json({
        success: true,
        data: {
          ...formatBucket(bucket),
          policy,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ─── POST /admin/quota/:key/reset ─────────────────────────────────────────────

/**
 * Force-reset the quota window for a specific key.
 * Useful for support workflows ("I hit my limit, can you reset me?").
 */
router.post(
  '/admin/quota/:key/reset',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const operatorId = requireOperator(req, res);
      if (!operatorId) return;

      const apiKey = req.params['key']?.trim();
      if (!apiKey) {
        sendError(res, 'INVALID_KEY', 'API key parameter is required', 400);
        return;
      }

      const bucket = resetQuota(apiKey);

      return res.status(200).json({
        success: true,
        message: `Quota reset for key ${apiKey}`,
        operatorId,
        data: formatBucket(bucket),
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ─── PUT /admin/quota/:key/policy ─────────────────────────────────────────────

/**
 * Set a custom quota policy for a specific API key.
 *
 * Body: { "limit": 500, "windowMs": 60000 }
 */
router.put(
  '/admin/quota/:key/policy',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const operatorId = requireOperator(req, res);
      if (!operatorId) return;

      const apiKey = req.params['key']?.trim();
      if (!apiKey) {
        sendError(res, 'INVALID_KEY', 'API key parameter is required', 400);
        return;
      }

      const { limit, windowMs } = req.body as Partial<QuotaPolicy>;

      if (typeof limit !== 'number' || limit < 1) {
        sendError(res, 'INVALID_POLICY', 'limit must be a number >= 1', 400);
        return;
      }
      if (typeof windowMs !== 'number' || windowMs < 1) {
        sendError(res, 'INVALID_POLICY', 'windowMs must be a number >= 1', 400);
        return;
      }

      try {
        setPolicy(apiKey, { limit, windowMs });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Invalid policy';
        sendError(res, 'INVALID_POLICY', msg, 400);
        return;
      }

      return res.status(200).json({
        success: true,
        message: `Policy updated for key ${apiKey}`,
        operatorId,
        data: { key: apiKey, policy: { limit, windowMs } },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ─── DELETE /admin/quota/:key ─────────────────────────────────────────────────

/**
 * Delete all quota state (bucket + policy) for a specific API key.
 * The next request from that key will start a fresh window.
 */
router.delete(
  '/admin/quota/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const operatorId = requireOperator(req, res);
      if (!operatorId) return;

      const apiKey = req.params['key']?.trim();
      if (!apiKey) {
        sendError(res, 'INVALID_KEY', 'API key parameter is required', 400);
        return;
      }

      deleteKey(apiKey);

      return res.status(200).json({
        success: true,
        message: `Quota state deleted for key ${apiKey}`,
        operatorId,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
