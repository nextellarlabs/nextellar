import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

/**
 * GET /shipping
 * Returns the shipping city for the authenticated user.
 * Uses optional chaining to prevent TypeErrors when profile or address is missing.
 */
router.get(
  "/",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized: missing user context" });
        return;
      }

      // Fetch user with profile (mocked service call)
      const user = await getUserWithProfile(req.user.sub);

      // Null guard before accessing nested properties
      const city = user?.profile?.address?.city;

      if (!city) {
        res.status(404).json({ error: "No shipping address found" });
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

/**
 * Mocks fetching a user with a nested profile and address.
 */
async function getUserWithProfile(userId: string): Promise<any> {
  // Mock logic: 
  // - User "1" has a full profile.
  // - User "2" has a profile but no address.
  // - Others have no profile at all.
  
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
      profile: {
        // No address
      }
    };
  }

  return {
    id: userId,
    username: "unknown"
    // No profile
  };
}
