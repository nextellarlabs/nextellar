import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';
import {
  generateSuspiciousActivityReport,
  getSarRulesConfig,
  reloadSarRulesConfig,
  type ActivityRecord,
  type SarRulesConfig,
  SarRulesConfigError,
} from '../lib/sarRules.js';

const router = Router();

function isActivityRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.trim() !== '' &&
    typeof record.timestamp === 'string' &&
    record.timestamp.trim() !== '' &&
    typeof record.type === 'string' &&
    record.type.trim() !== ''
  );
}

function parseActivities(body: unknown): ActivityRecord[] | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const activities = (body as { activities?: unknown }).activities;
  if (!Array.isArray(activities)) {
    return null;
  }
  if (!activities.every(isActivityRecord)) {
    return null;
  }
  return activities;
}

function parseRulesConfig(body: unknown): SarRulesConfig | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const config = (body as { config?: unknown }).config;
  if (!config || typeof config !== 'object') {
    return null;
  }
  const version = (config as SarRulesConfig).version;
  const rules = (config as SarRulesConfig).rules;
  if (typeof version !== 'string' || !Array.isArray(rules)) {
    return null;
  }
  return config as SarRulesConfig;
}

/**
 * GET /compliance/sar/rules
 * Return the active versioned SAR detection rules.
 */
router.get(
  '/compliance/sar/rules',
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      return res.status(200).json({
        success: true,
        data: getSarRulesConfig(),
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * POST /compliance/sar/rules/reload
 * Replace SAR detection rules with a new versioned configuration.
 */
router.post(
  '/compliance/sar/rules/reload',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = parseRulesConfig(req.body);
      if (!config) {
        sendError(res, 'VALIDATION_ERROR', 'Body must include config.version and config.rules', 400);
        return;
      }

      const loaded = reloadSarRulesConfig(config);
      return res.status(200).json({
        success: true,
        data: loaded,
      });
    } catch (err) {
      if (err instanceof SarRulesConfigError) {
        sendError(res, 'INVALID_RULES_CONFIG', err.message, 400);
        return;
      }
      return next(err);
    }
  },
);

/**
 * POST /compliance/sar/generate
 * Evaluate activity records and emit a structured SAR JSON report with annotated rule hits.
 */
router.post(
  '/compliance/sar/generate',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const subjectId =
        typeof req.body?.subjectId === 'string' ? req.body.subjectId.trim() : '';

      if (!subjectId) {
        sendError(res, 'VALIDATION_ERROR', 'subjectId is required', 400);
        return;
      }

      const activities = parseActivities(req.body);
      if (activities === null) {
        sendError(
          res,
          'VALIDATION_ERROR',
          'activities must be a non-empty array of valid activity records',
          400,
        );
        return;
      }

      if (activities.length === 0) {
        sendError(res, 'VALIDATION_ERROR', 'At least one activity is required', 400);
        return;
      }

      const report = generateSuspiciousActivityReport(subjectId, activities);
      return res.status(200).json({
        success: true,
        data: report,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
