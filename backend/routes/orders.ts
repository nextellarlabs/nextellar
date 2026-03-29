import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// Mock data source
const MOCK_ORDERS = Array.from({ length: 200 }, (_, i) => ({
    id: `order-${i + 1}`,
    amount: (Math.random() * 1000).toFixed(2),
    status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "pending" : "cancelled",
    createdAt: new Date(Date.now() - i * 3600000).toISOString(),
}));

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * GET /orders
 * Returns a paginated list of orders.
 * Query params:
 *  - page: number (default 1)
 *  - limit: number (default 20, max 100)
 */
router.get(
    "/",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            let page = parseInt(req.query.page as string) || 1;
            let limit = parseInt(req.query.limit as string) || DEFAULT_LIMIT;

            // Ensure page is at least 1
            if (page < 1) page = 1;

            // Enforce maximum limit and ensure limit is at least 1
            if (limit < 1) limit = DEFAULT_LIMIT;
            if (limit > MAX_LIMIT) limit = MAX_LIMIT;

            const total = MOCK_ORDERS.length;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;

            const data = MOCK_ORDERS.slice(startIndex, endIndex);

            res.status(200).json({
                success: true,
                total,
                page,
                limit,
                data,
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
