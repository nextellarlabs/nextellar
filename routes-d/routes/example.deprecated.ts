/**
 * Example route demonstrating deprecation middleware usage
 * 
 * This is a sample deprecated endpoint that shows how the middleware
 * automatically adds deprecation headers based on the manifest.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';

const router = Router();

/**
 * GET /api/v1/example
 * 
 * This endpoint is marked as deprecated in the manifest.
 * When accessed, it will automatically include:
 * - Deprecation: true
 * - Sunset: <date>
 * - Link: <migration-guide>
 * - X-Deprecation-Message: <message>
 */
router.get(
  '/api/v1/example',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Normal route logic - deprecation headers are added automatically
      const data = {
        message: 'This endpoint still works but is deprecated',
        timestamp: new Date().toISOString(),
      };

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v2/example
 * 
 * This is the new version of the endpoint that clients should migrate to.
 * It will not have any deprecation headers.
 */
router.get(
  '/api/v2/example',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = {
        message: 'This is the new endpoint version',
        timestamp: new Date().toISOString(),
        features: ['improved performance', 'better error handling'],
      };

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
