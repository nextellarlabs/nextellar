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

// In-memory user store (mock database)
const users = new Map<string, UserProfile>();

/**
 * GET /account/me
 * Return the authenticated user's profile.
 */
router.get(
  "/account/me",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const user = users.get(userId);

      if (!user) {
        sendError(res, "USER_NOT_FOUND", "Authenticated user profile not found", 404);
        return;
      }

      const safeProfile: Record<string, unknown> = {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      };
      if (user.displayName) safeProfile.displayName = user.displayName;
      if (user.avatarUrl) safeProfile.avatarUrl = user.avatarUrl;

      return res.status(200).json({ success: true, data: safeProfile });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getUsers(): Map<string, UserProfile> {
  return users;
}

export function __resetUsers(): void {
  users.clear();
}

export function __seedUser(user: UserProfile): void {
  users.set(user.id, user);
}

export default router;
