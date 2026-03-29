import { Router, Request, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

// Mock data source with userId association
const MOCK_ORDERS = Array.from({ length: 200 }, (_, i) => ({
    id: `order-${i + 1}`,
    userId: i % 5 === 0 ? "user-1" : i % 5 === 1 ? "user-2" : i % 5 === 2 ? "user-3" : i % 5 === 3 ? "user-4" : "user-5",
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

/**
 * GET /orders/:id
 * Returns orders for a specific user.
 * Requires authentication and ownership verification.
 * Non-owners receive 403 Forbidden (not 404 to avoid leaking existence).
 * Admin users can bypass ownership check.
 *
 * Query params:
 *  - page: number (default 1)
 *  - limit: number (default 20, max 100)
 */
router.get(
    "/:id",
    authenticate,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params;
            const user = req.user;

            if (!user) {
                res.status(401).json({ success: false, message: "Unauthorized" });
                return;
            }

            // Check ownership: user can only view their own orders unless they're admin
            if (user.role !== "admin" && user.sub !== id) {
                res.status(403).json({
                    success: false,
                    message: "Forbidden: you do not have access to this resource",
                });
                return;
            }

            let page = parseInt(req.query.page as string) || 1;
            let limit = parseInt(req.query.limit as string) || DEFAULT_LIMIT;

            // Ensure page is at least 1
            if (page < 1) page = 1;

            // Enforce maximum limit and ensure limit is at least 1
            if (limit < 1) limit = DEFAULT_LIMIT;
            if (limit > MAX_LIMIT) limit = MAX_LIMIT;

            // Filter orders by user ID
            const userOrders = MOCK_ORDERS.filter((order) => order.userId === id);
            const total = userOrders.length;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;

            const data = userOrders.slice(startIndex, endIndex);

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
