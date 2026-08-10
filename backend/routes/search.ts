import { Router, Request, Response, NextFunction } from "express";
import escapeStringRegexp from "escape-string-regexp";
import { sendError } from "../utils/response.js";

const router = Router();

const MAX_QUERY_LENGTH = 200;
const MOCK_RESULTS = [
    { id: "1", title: "Stellar Documentation", url: "/docs/stellar" },
    { id: "2", title: "Smart Contracts Guide", url: "/docs/contracts" },
    { id: "3", title: "API Reference", url: "/docs/api" },
    { id: "4", title: "Getting Started", url: "/docs/getting-started" },
    { id: "5", title: "Examples", url: "/docs/examples" },
];

/**
 * GET /search
 * Search endpoint with ReDoS protection.
 * Query parameter:
 *  - q: search query (max 200 chars, treated as literal string)
 */
router.get(
    "/",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const query = (req.query.q as string) || "";

            if (query.length > MAX_QUERY_LENGTH) {
                sendError(res, 'QUERY_TOO_LONG', `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`, 400);
                return;
            }

            if (!query) {
                res.status(200).json({
                    success: true,
                    query: "",
                    results: MOCK_RESULTS,
                    count: MOCK_RESULTS.length,
                });
                return;
            }

            const escapedQuery = escapeStringRegexp(query);
            const safeRegex = new RegExp(escapedQuery, "i");

            const results = MOCK_RESULTS.filter(
                (item) =>
                    safeRegex.test(item.title) ||
                    safeRegex.test(item.url) ||
                    safeRegex.test(item.id)
            );

            res.status(200).json({
                success: true,
                query,
                results,
                count: results.length,
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
