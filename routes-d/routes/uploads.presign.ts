import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../../backend/middleware/auth.js';
import { sendError } from '../../backend/utils/response.js';
import {
  generatePresignUrl,
  validatePresignUrl,
  getPresignLogs,
  clearExpiredLogs,
  clearPresignLogs,
  type PresignOptions,
  type PresignLogEntry,
} from '../lib/presignUrl.js';

const router = Router();

interface PresignRequestBody {
  bucket: string;
  key: string;
  ttl?: number;
  contentType?: string;
  method?: 'PUT' | 'POST' | 'GET';
  maxSize?: number;
}

/**
 * POST /uploads/presign
 * Generate a pre-signed URL for file upload
 * Request body: bucket, key, ttl (optional), contentType (optional), method (optional), maxSize (optional)
 * Returns: pre-signed URL with expiration and required headers
 */
router.post(
  '/uploads/presign',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
        return;
      }

      const { bucket, key, ttl, contentType, method, maxSize } = req.body as PresignRequestBody;

      // Validate required fields
      if (!bucket || typeof bucket !== 'string' || bucket.trim().length === 0) {
        sendError(res, 'INVALID_BUCKET', 'bucket is required and must be a non-empty string', 400);
        return;
      }

      if (!key || typeof key !== 'string' || key.trim().length === 0) {
        sendError(res, 'INVALID_KEY', 'key is required and must be a non-empty string', 400);
        return;
      }

      // Validate bucket name format (alphanumeric, hyphens, underscores)
      if (!/^[a-zA-Z0-9-_]+$/.test(bucket)) {
        sendError(res, 'INVALID_BUCKET', 'bucket must contain only alphanumeric characters, hyphens, and underscores', 400);
        return;
      }

      // Validate key format (no leading slashes, reasonable length)
      if (key.startsWith('/') || key.length > 1024) {
        sendError(res, 'INVALID_KEY', 'key must not start with / and must be less than 1024 characters', 400);
        return;
      }

      // Validate TTL if provided
      if (ttl !== undefined) {
        const ttlNum = Number(ttl);
        if (isNaN(ttlNum) || ttlNum <= 0 || ttlNum > 86400) {
          sendError(res, 'INVALID_TTL', 'ttl must be between 1 and 86400 seconds (24 hours)', 400);
          return;
        }
      }

      // Validate content type if provided
      if (contentType !== undefined && typeof contentType !== 'string') {
        sendError(res, 'INVALID_CONTENT_TYPE', 'contentType must be a string', 400);
        return;
      }

      // Validate method if provided
      if (method !== undefined && !['PUT', 'POST', 'GET'].includes(method)) {
        sendError(res, 'INVALID_METHOD', 'method must be PUT, POST, or GET', 400);
        return;
      }

      // Validate max size if provided
      if (maxSize !== undefined) {
        const maxSizeNum = Number(maxSize);
        if (isNaN(maxSizeNum) || maxSizeNum <= 0 || maxSizeNum > 10737418240) {
          sendError(res, 'INVALID_MAX_SIZE', 'maxSize must be between 1 and 10737418240 bytes (10GB)', 400);
          return;
        }
      }

      // Generate pre-signed URL
      const options: PresignOptions = {
        bucket,
        key,
        ttl,
        contentType,
        method,
        maxSize,
      };

      const result = generatePresignUrl(options, userId);

      res.status(200).json({
        success: true,
        data: {
          url: result.url,
          expiresAt: result.expiresAt.toISOString(),
          method: result.method,
          headers: result.headers,
        },
      });
    } catch (error) {
      if (error instanceof Error) {
        sendError(res, 'PRESIGN_ERROR', error.message, 500);
      } else {
        next(error);
      }
    }
  },
);

/**
 * POST /uploads/presign/validate
 * Validate a pre-signed URL
 * Request body: url
 * Returns: true if valid, false otherwise
 */
router.post(
  '/uploads/presign/validate',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
        return;
      }

      const { url } = req.body;

      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        sendError(res, 'INVALID_URL', 'url is required and must be a non-empty string', 400);
        return;
      }

      const isValid = validatePresignUrl(url);

      res.status(200).json({
        success: true,
        data: {
          valid: isValid,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /uploads/presign/logs
 * Get presign URL issuance logs for the authenticated user
 * Query params: limit (optional, default: 50)
 */
router.get(
  '/uploads/presign/logs',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
        return;
      }

      const { limit = '50' } = req.query;
      const limitNum = parseInt(String(limit), 10);

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, 'INVALID_LIMIT', 'limit must be between 1 and 100', 400);
        return;
      }

      // Clear expired logs first
      clearExpiredLogs();

      const logs = getPresignLogs(userId).slice(0, limitNum);

      res.status(200).json({
        success: true,
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /uploads/presign/clear-logs
 * Clear all presign logs (admin operation)
 */
router.post(
  '/uploads/presign/clear-logs',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
        return;
      }

      // In a real implementation, check if user has admin privileges
      // For now, we'll allow any authenticated user

      clearPresignLogs();

      res.status(200).json({
        success: true,
        message: 'Presign logs cleared successfully',
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
