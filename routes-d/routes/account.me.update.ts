import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type UserProfile = {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: string;
};

type AuditEntry = {
  userId: string;
  changedFields: string[];
  before: Partial<UserProfile>;
  after: Partial<UserProfile>;
  updatedAt: string;
};

type ProfileUpdate = {
  displayName?: string;
  avatarUrl?: string;
};

const users = new Map<string, UserProfile>();
const audit: AuditEntry[] = [];

const EDITABLE_FIELDS: Array<keyof ProfileUpdate> = ["displayName", "avatarUrl"];

/**
 * PATCH /account/me
 * Update editable profile fields for the authenticated user.
 */
router.patch(
  "/account/me",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const body = req.body as ProfileUpdate;

      if (body.displayName !== undefined) {
        if (typeof body.displayName !== "string" || body.displayName.trim() === "") {
          sendError(res, "INVALID_DISPLAY_NAME", "displayName must be a non-empty string", 400);
          return;
        }
      }

      if (body.avatarUrl !== undefined) {
        if (typeof body.avatarUrl !== "string" || body.avatarUrl.trim() === "") {
          sendError(res, "INVALID_AVATAR_URL", "avatarUrl must be a non-empty string", 400);
          return;
        }
      }

      const user = users.get(userId);

      if (!user) {
        sendError(res, "USER_NOT_FOUND", "Authenticated user profile not found", 404);
        return;
      }

      const provided = EDITABLE_FIELDS.filter((k) => body[k] !== undefined);

      if (provided.length === 0) {
        return res.status(200).json({
          success: true,
          data: { updated: false, profile: toSafeProfile(user) },
        });
      }

      const noop = provided.every((k) => body[k] === user[k]);
      if (noop) {
        return res.status(200).json({
          success: true,
          data: { updated: false, profile: toSafeProfile(user) },
        });
      }

      const before: Partial<UserProfile> = {};
      const after: Partial<UserProfile> = {};
      const changedFields: string[] = [];

      for (const k of provided) {
        if (body[k] !== user[k]) {
          before[k] = user[k];
          user[k] = body[k] as string;
          after[k] = user[k];
          changedFields.push(k);
        }
      }

      audit.push({
        userId,
        changedFields,
        before,
        after,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({
        success: true,
        data: { updated: true, profile: toSafeProfile(user) },
      });
    } catch (err) {
      return next(err);
    }
  },
);

function toSafeProfile(user: UserProfile): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
  };
  if (user.displayName) profile.displayName = user.displayName;
  if (user.avatarUrl) profile.avatarUrl = user.avatarUrl;
  return profile;
}

export function __resetUsers(): void {
  users.clear();
}

export function __seedUser(user: UserProfile): void {
  users.set(user.id, user);
}

export function __getUsers(): Map<string, UserProfile> {
  return users;
}

export function __resetAudit(): void {
  audit.length = 0;
}

export function __getAudit(): AuditEntry[] {
  return audit;
}

export default router;
