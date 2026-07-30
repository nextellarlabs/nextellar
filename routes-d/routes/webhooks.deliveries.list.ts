import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../../backend/middleware/auth.js";
import { sendError } from "../../backend/utils/response.js";

const router = Router();

interface WebhookDelivery {
  id: string;
  webhookId: string;
  attemptNumber: number;
  responseCode: number;
  latency: number;
  attemptTime: Date;
  success: boolean;
  errorMessage?: string;
}

// Mock storage for webhook deliveries
const webhookDeliveries = new Map<string, WebhookDelivery[]>();

/**
 * GET /webhooks/:id/deliveries
 * List recent delivery attempts for a webhook.
 * Includes response code, latency, and attempt number.
 * Paginated sorted by attempt time (newest first).
 */
router.get(
  "/:id/deliveries",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "User not authenticated", 401);
        return;
      }

      // Parse pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;

      if (page < 1 || limit < 1 || limit > 100) {
        sendError(res, "INVALID_PAGINATION", "Page must be >= 1 and limit must be between 1 and 100", 400);
        return;
      }

      const deliveries = webhookDeliveries.get(id) || [];

      // Sort by attempt time (newest first)
      const sortedDeliveries = [...deliveries].sort(
        (a, b) => b.attemptTime.getTime() - a.attemptTime.getTime()
      );

      // Apply pagination
      const paginatedDeliveries = sortedDeliveries.slice(offset, offset + limit);

      res.status(200).json({
        success: true,
        data: paginatedDeliveries,
        pagination: {
          page,
          limit,
          total: deliveries.length,
          totalPages: Math.ceil(deliveries.length / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
export { webhookDeliveries };
