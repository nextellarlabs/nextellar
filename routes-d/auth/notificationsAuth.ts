import { Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Middleware to authenticate requests to the notifications feed endpoints.
 * Expects `x-user-id` header or `Authorization: Bearer <userId>`.
 */
export function requireNotificationAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const userIdHeader = req.headers["x-user-id"] as string | undefined;
  const authHeader = req.headers.authorization;

  let userId: string | undefined = userIdHeader;

  if (!userId && authHeader && authHeader.startsWith("Bearer ")) {
    userId = authHeader.substring(7).trim();
  }

  if (!userId) {
    sendError(res, "UNAUTHORIZED", "Authentication required", 401);
    return;
  }

  req.userId = userId;
  next();
}
