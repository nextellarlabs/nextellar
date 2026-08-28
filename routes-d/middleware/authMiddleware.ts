/**
 * authMiddleware.ts
 *
 * Admin auth guard for routes-d.
 *
 * Authentication strategy (matches the existing admin routes pattern):
 *  - x-operator-id header  → identifies the calling operator
 *  - x-operator-scopes header → comma-separated scope list
 *
 * A Bearer token in Authorization is also accepted (forwarded to the
 * existing verifyToken helper from backend/auth/token.ts when present),
 * but the operator headers are the primary mechanism used by existing
 * admin routes in this codebase.
 */

import { Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OperatorContext {
  operatorId: string;
  scopes: string[];
}

export type AuthenticatedRequest = Request & {
  operator?: OperatorContext;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractOperator(req: Request): OperatorContext | null {
  const operatorId =
    (req.headers["x-operator-id"] as string | undefined)?.trim() ||
    ((req.body as Record<string, unknown>)?.operatorId as string | undefined)?.trim();

  if (!operatorId) return null;

  const scopesHeader = req.headers["x-operator-scopes"] as string | undefined;
  const scopes = scopesHeader
    ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return { operatorId, scopes };
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * requireOperator – rejects requests that have no x-operator-id.
 */
export function requireOperator(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const ctx = extractOperator(req);

  if (!ctx) {
    sendError(res, "UNAUTHORIZED", "Operator identity required", 401);
    return;
  }

  req.operator = ctx;
  next();
}

/**
 * requireScope(scope) – middleware factory that ensures the operator has a
 * specific scope in x-operator-scopes.
 *
 * Must be used after requireOperator (or another middleware that populates
 * req.operator).
 */
export function requireScope(scope: string) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    const ctx = req.operator ?? extractOperator(req);

    if (!ctx) {
      sendError(res, "UNAUTHORIZED", "Operator identity required", 401);
      return;
    }

    if (!ctx.scopes.includes(scope)) {
      sendError(
        res,
        "FORBIDDEN",
        `Operator does not have the required scope: ${scope}`,
        403,
      );
      return;
    }

    if (!req.operator) req.operator = ctx;
    next();
  };
}
