import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { sendError } from "../utils/response.js";

const router = Router();

/**
 * GET /shipping
 * Returns the shipping city for the authenticated user.
 */
router.get(
  "/",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        sendError(res, 'UNAUTHORIZED', 'Unauthorized: missing user context', 401);
        return;
      }

      const user = await getUserWithProfile(req.user.sub);

      const city = user?.profile?.address?.city;

      if (!city) {
        sendError(res, 'NOT_FOUND', 'No shipping address found', 404);
        return;
      }

      res.status(200).json({ success: true, city });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

// ---------------------------------------------------------------------------
// Mock Service Layer
// ---------------------------------------------------------------------------
async function getUserWithProfile(userId: string): Promise<any> {
  if (userId === "1") {
    return {
      id: "1",
      username: "alice",
      profile: {
        address: {
          city: "San Francisco",
          street: "123 Market St"
        }
      }
    };
  }

  if (userId === "2") {
    return {
      id: "2",
      username: "bob",
      profile: {}
    };
  }

  return { id: userId, username: "unknown" };
}
