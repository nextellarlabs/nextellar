import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../../backend/middleware/auth.js';
import { sendError } from '../../backend/utils/response.js';
import { FTSIndex, type Document, type SearchOptions } from '../lib/ftsIndex.js';

const router = Router();

type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded';

interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string;
  shippingAddress: string;
  items: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Mock storage for orders
const orders = new Map<string, Order>();

// Initialize FTS index for orders
const orderFTSIndex = new FTSIndex();

/**
 * Initialize the FTS index with existing orders
 */
function initializeFTSIndex(): void {
  const ordersArray = Array.from(orders.values());
  for (const order of ordersArray) {
    const document: Document = {
      id: order.id,
      fields: {
        description: order.description,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        shippingAddress: order.shippingAddress,
        items: order.items,
        notes: order.notes || '',
        status: order.status,
      },
    };
    orderFTSIndex.addDocument(document);
  }
}

/**
 * POST /orders/search
 * Full-text search over orders
 * Query params: q (query string), limit, minScore
 * Returns ranked search results with relevance scores
 */
router.post(
  '/orders/search',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
        return;
      }

      const { q, limit = '10', minScore = '0' } = req.body;

      if (!q || typeof q !== 'string' || q.trim().length === 0) {
        sendError(res, 'INVALID_QUERY', 'Query parameter "q" is required', 400);
        return;
      }

      const limitNum = parseInt(String(limit), 10);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, 'INVALID_LIMIT', 'limit must be between 1 and 100', 400);
        return;
      }

      const minScoreNum = parseFloat(String(minScore));
      if (isNaN(minScoreNum) || minScoreNum < 0) {
        sendError(res, 'INVALID_SCORE', 'minScore must be a non-negative number', 400);
        return;
      }

      // Ensure FTS index is initialized
      if (orderFTSIndex.size() === 0) {
        initializeFTSIndex();
      }

      const options: SearchOptions = {
        limit: limitNum,
        minScore: minScoreNum,
      };

      const searchResults = orderFTSIndex.search(q, options);

      // Filter results to only show orders accessible to the user
      // (In a real implementation, this would check permissions)
      const filteredResults = searchResults.filter((result) => {
        const order = orders.get(result.document.id);
        return order?.customerId === userId;
      });

      // Map search results to response format
      const responseData = filteredResults.map((result) => {
        const order = orders.get(result.document.id);
        return {
          id: result.document.id,
          customerId: order?.customerId,
          status: order?.status,
          amount: order?.amount,
          currency: order?.currency,
          description: order?.description,
          customerName: order?.customerName,
          customerEmail: order?.customerEmail,
          createdAt: order?.createdAt,
          updatedAt: order?.updatedAt,
          score: result.score,
          matchedFields: result.matchedFields,
        };
      });

      res.status(200).json({
        success: true,
        data: responseData,
        meta: {
          query: q,
          totalResults: filteredResults.length,
          limit: limitNum,
          minScore: minScoreNum,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /orders/fts/stats
 * Get statistics about the FTS index
 */
router.get(
  '/orders/fts/stats',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
        return;
      }

      // Ensure FTS index is initialized
      if (orderFTSIndex.size() === 0) {
        initializeFTSIndex();
      }

      const stats = orderFTSIndex.getStats();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /orders/fts/reindex
 * Rebuild the FTS index (admin operation)
 */
router.post(
  '/orders/fts/reindex',
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

      // Clear and rebuild index
      orderFTSIndex.clear();
      initializeFTSIndex();

      const stats = orderFTSIndex.getStats();

      res.status(200).json({
        success: true,
        message: 'FTS index rebuilt successfully',
        data: stats,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
export { orders, orderFTSIndex };
