import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type UserStatus = "active" | "frozen" | "closed";

type UserRecord = {
  id: string;
  status: UserStatus;
  frozenAt?: string;
  frozenBy?: string;
  updatedAt: string;
};

type AuditEvent = {
  userId: string;
  action: "user.freeze";
  performedBy: string;
  scope: string;
  timestamp: string;
};

const users = new Map<string, UserRecord>();
const auditLog: AuditEvent[] = [];

router.post(
  "/admin/users/:id/freeze",
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

      if (user.status === "frozen") {
        sendError(res, "ALREADY_FROZEN", "Account is already frozen", 409);
        return;
      }

      const now = new Date().toISOString();
      user.status = "frozen";
      user.frozenAt = now;
      user.frozenBy = operatorId.trim();
      user.updatedAt = now;

      auditLog.push({
        userId,
        action: "user.freeze",
        performedBy: operatorId.trim(),
        scope: "freeze",
        timestamp: now,
      });

      return res.status(200).json({
        success: true,
        data: {
          userId,
          status: "frozen",
          frozenAt: now,
          frozenBy: operatorId.trim(),
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
