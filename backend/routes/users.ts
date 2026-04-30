import { Router, Request, Response, NextFunction } from "express";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.js";
import { noCache } from "../middleware/noCache.js";
import { sendError } from "../utils/response.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Explicit allowlist — only these fields ever leave the server
type SafeUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  role: string;
};

function toSafeUser(user: Record<string, unknown>): SafeUser {
  return {
    id: user.id as string,
    username: user.username as string,
    email: user.email as string,
    createdAt: user.createdAt as string,
    role: user.role as string,
  };
}

// In-memory user store (mock)
export const users: Map<string, { id: string; name: string }> = new Map([
  ["1", { id: "1", name: "Alice" }],
  ["2", { id: "2", name: "Bob" }],
]);

/**
 * GET /me
 * Returns the currently authenticated user's profile.
 */
router.get(
  "/me",
  authenticate,
  noCache,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return sendError(res, "UNAUTHORIZED", "Unauthorized", 401);
      }

      const user = await getUserById(userId);

      if (!user) {
        return sendError(res, "NOT_FOUND", "User not found", 404);
      }

      res.status(200).json({ success: true, data: toSafeUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /:id
 */
router.get(
  "/:id",
  noCache,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params["id"] as string;

      if (!UUID_REGEX.test(id)) {
        return sendError(res, "INVALID_ID", "Invalid id format", 400);
      }

      const user = await deps.getUserById(id);

      if (!user) {
        return sendError(res, "NOT_FOUND", "User not found", 404);
      }

      res.status(200).json({ success: true, data: toSafeUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /:id
 */
router.delete(
  "/:id",
  authenticate,
  requireRole("admin"),
  (req: AuthenticatedRequest, res: Response): void => {
    const id = req.params["id"] as string;

    if (!users.has(id)) {
      return sendError(res, "NOT_FOUND", "User not found", 404);
    }

    users.delete(id);
    res.status(200).json({
      success: true,
      message: `User ${id} deleted successfully`,
    });
  }
);

export default router;

// ---------------------------------------------------------------------------
// Stub (replace with real DB/service)
// ---------------------------------------------------------------------------
export const deps = {
  async getUserById(_id: string): Promise<Record<string, unknown> | null> {
    return null;
  },
};

export const getUserById = (id: string) => deps.getUserById(id);