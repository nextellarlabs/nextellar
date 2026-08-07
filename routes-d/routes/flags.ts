/**
 * routes-d/routes/flags.ts
 *
 * Exposes flag status information via HTTP.
 *
 *   GET  /flags/status          – raw config snapshot (no user bucketing)
 *   GET  /flags/user            – per-user flag evaluation (requires x-user-id header)
 *   POST /flags/reload          – hot-reload flags from FEATURE_FLAGS_JSON env var
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  getFlagStatus,
  getFlagsForUser,
  reloadFlags,
} from '../lib/featureFlags.js';
import { sendError } from '../lib/response.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /flags/status
// Returns a raw snapshot of all current flag definitions and metadata.
// ---------------------------------------------------------------------------
router.get(
  '/flags/status',
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      const status = getFlagStatus();
      return res.status(200).json({
        success: true,
        data: status,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /flags/user
// Returns per-user evaluated flags (true/false per flag).
// Requires x-user-id header.
// ---------------------------------------------------------------------------
router.get(
  '/flags/user',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers['x-user-id'] as string | undefined;

      if (!userId || userId.trim() === '') {
        sendError(res, 'UNAUTHORIZED', 'x-user-id header is required', 401);
        return;
      }

      const flags = getFlagsForUser(userId.trim());

      return res.status(200).json({
        success: true,
        data: { userId: userId.trim(), flags },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /flags/reload
// Triggers a hot-reload of flag definitions from FEATURE_FLAGS_JSON.
// Returns whether new env-based flags were loaded or defaults were used.
// ---------------------------------------------------------------------------
router.post(
  '/flags/reload',
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      const loaded = reloadFlags();
      const status = getFlagStatus();

      return res.status(200).json({
        success: true,
        data: {
          reloaded: true,
          source: status.source,
          loadedAt: status.loadedAt,
          flagCount: Object.keys(status.flags).length,
          envProvided: loaded,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
