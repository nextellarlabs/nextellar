import { Router, Request, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { sendError } from "../utils/response.js";

const router = Router();

/**
 * GET /health
 * Public health check endpoint.
 * Returns only { status: 'ok' } without internal details.
 */
router.get(
    "/",
    async (_req: Request, res: Response, next: NextFunction) => {
        try {
            res.status(200).json({ status: "ok" });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /health/detailed
 * Protected health check endpoint for internal diagnostics.
 * Requires X-Internal-Key header matching INTERNAL_API_KEY env var.
 */
router.get(
    "/detailed",
    authenticate,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const internalKey = req.headers["x-internal-key"] as string;
            const expectedKey = process.env.INTERNAL_API_KEY;

            if (!expectedKey) {
                sendError(res, 'MISCONFIGURED', 'Internal API key not configured', 500);
                return;
            }

            if (!internalKey || internalKey !== expectedKey) {
                sendError(res, 'FORBIDDEN', 'Invalid or missing internal API key', 403);
                return;
            }

            const detailedHealth = {
                status: "ok",
                appVersion: process.env.APP_VERSION || "unknown",
                nodeVersion: process.version,
                env: process.env.NODE_ENV || "development",
                dbHost: process.env.DB_HOST || "localhost",
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
            };

            res.status(200).json(detailedHealth);
        } catch (err) {
            next(err);
        }
    }
);

export default router;
