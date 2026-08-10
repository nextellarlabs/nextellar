import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type UserStatus = "active" | "frozen" | "closed";

type UserRecord = {
  id: string;
  status: UserStatus;
  frozenAt?: string;
  unfrozenAt?: string;
  unfrozenBy?: string;
  updatedAt: string;
};

type AuditEvent = {
  userId: string;
  action: "user.unfreeze";
  performedBy: string;
  scope: string;
  timestamp: string;
};

// In-memory store
const users = new Map<string, UserRecord>();
const auditLog: AuditEvent[] = [];

/**
 * POST /admin/users/:id/unfreeze
 * Lift a freeze on a Nextellar user account.
 * Requires an operator identity with the "freeze" scope.
 * Emits an audit event on success.
 * Rejects with 409 when the account is not currently frozen.
 */
router.post(
  "/admin/users/:id/unfreeze",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id?.trim();
      if (!userId) {
        sendError(res, "INVALID_USER_ID", "User ID is required", 400);
        return;
      }

      const operatorId =
        (req.body?.operatorId as string | undefined) ||
        (req.headers["x-operator-id"] as string | undefined);

      if (!operatorId || !operatorId.trim()) {
        sendError(res, "UNAUTHORIZED", "Operator identity required", 401);
        return;
      }

      const scopesHeader = req.headers["x-operator-scopes"] as string | undefined;
      const scopes = scopesHeader ? scopesHeader.split(",").map((s) => s.trim()) : [];

      if (!scopes.includes("freeze")) {
        sendError(res, "FORBIDDEN", "Operator does not have the freeze scope", 403);
        return;
      }

      const user = users.get(userId);
      if (!user) {
        sendError(res, "USER_NOT_FOUND", "User not found", 404);
        return;
      }

      if (user.status !== "frozen") {
        sendError(res, "NOT_FROZEN", "Account is not currently frozen", 409);
        return;
      }

      const now = new Date().toISOString();
      user.status = "active";
      user.unfrozenAt = now;
      user.unfrozenBy = operatorId.trim();
      user.updatedAt = now;

      auditLog.push({
        userId,
        action: "user.unfreeze",
        performedBy: operatorId.trim(),
        scope: "freeze",
        timestamp: now,
      });

      return res.status(200).json({
        success: true,
        data: {
          userId,
          status: "active",
          unfrozenAt: now,
          unfrozenBy: operatorId.trim(),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedUser(user: UserRecord): void {
  users.set(user.id, { ...user });
}

export function __getUser(id: string): UserRecord | undefined {
  return users.get(id);
}

export function __getAuditLog(): AuditEvent[] {
  return auditLog;
}

export function __resetUsers(): void {
  users.clear();
  auditLog.length = 0;
}

export default router;
