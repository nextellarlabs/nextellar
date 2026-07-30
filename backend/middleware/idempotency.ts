import { Request, Response, NextFunction } from "express";

export interface IdempotencyRequest extends Request {
    idempotencyKey?: string;
    cachedResponse?: { status: number; body: unknown };
}

// In-memory store for idempotency keys
// In production, use Redis or a persistent store with TTL
interface IdempotencyEntry {
    status: number;
    body: unknown;
    expiresAt: number;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of idempotencyStore.entries()) {
        if (entry.expiresAt < now) {
            idempotencyStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Idempotency middleware.
 * Requires Idempotency-Key header (UUID format).
 * Stores request results for 24 hours to prevent duplicate processing.
 *
 * Usage: Apply to POST endpoints that should be idempotent (e.g., payments)
 */
export function idempotency(
    req: IdempotencyRequest,
    res: Response,
    next: NextFunction
): void {
    const idempotencyKey = req.headers["idempotency-key"] as string;

    // Validate idempotency key is present
    if (!idempotencyKey) {
        res.status(400).json({
            success: false,
            message: "Missing required header: Idempotency-Key",
        });
        return;
    }

    // Validate idempotency key format (UUID)
    const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
        res.status(400).json({
            success: false,
            message: "Invalid Idempotency-Key format (must be UUID)",
        });
        return;
    }

    // Check if we have a cached response for this key
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached && cached.expiresAt > Date.now()) {
        // Return cached response
        res.status(cached.status).json(cached.body);
        return;
    }

    // Store the idempotency key for later retrieval
    req.idempotencyKey = idempotencyKey;

    // Intercept res.json() to cache the response
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
        // Cache the response with 24-hour TTL
        const ttlMs = 24 * 60 * 60 * 1000;
        idempotencyStore.set(idempotencyKey, {
            status: res.statusCode,
            body,
            expiresAt: Date.now() + ttlMs,
        });

        return originalJson(body);
    };

    next();
}
