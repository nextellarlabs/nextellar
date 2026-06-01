// Request ID correlation middleware for routes-d.
//
// Behaviour:
//  - If the incoming request already carries an X-Request-Id header its value
//    is used as-is (allows callers / gateways to propagate their own IDs).
//  - Otherwise a new UUID-v4 is generated.
//  - The ID is attached to `res.locals.requestId` for use by route handlers.
//  - It is echoed back in the X-Request-Id response header so clients can
//    correlate logs end-to-end.
//  - `req.log` is augmented (if present) so every logger.info / logger.error
//    call made during the request automatically includes the request ID.

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export const REQUEST_ID_HEADER = "X-Request-Id";

// ---------------------------------------------------------------------------
// Minimal logger interface — compatible with pino / winston / console.
// ---------------------------------------------------------------------------

export interface RequestLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): RequestLogger;
}

// Augment Express Request so TypeScript knows about req.log.
declare module "express-serve-static-core" {
  interface Request {
    log?: RequestLogger;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * requestId middleware
 *
 * Attaches a request-scoped ID to every request/response pair:
 *  - `res.locals.requestId`  — readable by downstream handlers
 *  - `X-Request-Id` response header — echoed to clients
 *  - `req.log` child logger — if a logger was previously mounted, a child
 *    logger bound to `{ requestId }` replaces it so every log line carries
 *    the ID automatically.
 */
export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id =
    (req.headers[REQUEST_ID_HEADER.toLowerCase()] as string | undefined)?.trim() ||
    randomUUID();

  res.locals["requestId"] = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  // Bind the ID into the logger context when a logger is present on the request.
  if (req.log) {
    req.log = req.log.child({ requestId: id });
  }

  next();
}

export default requestId;
