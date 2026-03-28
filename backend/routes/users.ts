import { Router, Request, Response, NextFunction } from "express";

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
