import { Router, Request, Response, NextFunction } from "express";
import { authenticate, requireRole, AuthenticatedRequest } from "../middleware/auth.js";

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

// In-memory user store used as a stand-in for a real database.
// Keys are user ids; values are user records.
export const users: Map<string, { id: string; name: string }> = new Map([
  ["1", { id: "1", name: "Alice" }],
  ["2", { id: "2", name: "Bob" }],
]);

/**
 * GET /users/:id
 * Returns only allowlisted public fields — passwordHash is never serialised.
 */
router.get(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!UUID_REGEX.test(id)) {
        res.status(400).json({ success: false, message: "Invalid id format" });
        return;
      }

      const user = await getUserById(id);

      if (!user) {
        res.status(404).json({ success: false, message: "User not found" });
        return;
      }

      res.status(200).json({ success: true, data: toSafeUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:id
 *
 * Deletes the user with the given id.
 * Requires a valid Bearer token with the admin role in the Authorization header.
 *
 * Responses:
 *   200 – user deleted successfully
 *   401 – missing or invalid auth token
 *   403 – insufficient role (non-admin)
 *   404 – user not found
 */
router.delete("/:id", authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;

  if (!users.has(id)) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  users.delete(id);
  res.status(200).json({ message: `User ${id} deleted successfully` });
});

export default router;

// ---------------------------------------------------------------------------
// Stub — swap out for your actual service / DB layer
// ---------------------------------------------------------------------------
export async function getUserById(
  id: string,
): Promise<Record<string, unknown> | null> {
  void id;
  return null;
}
