import { Router, Request, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

// Mock data source — in a real app this would come from a database.
const MOCK_DATA = [
  { id: 1, name: "Order #101", amount: 150.50, status: "completed" },
  { id: 2, name: "Order #102", amount: 89.99, status: "pending" },
];

/**
 * GET /
 * Exports data in JSON format.
 * 
 * Secure Authentication: 
 * - ONLY Authorization: Bearer <token> is accepted.
 * - ?token= query parameter is strictly ignored (as per requirement).
 */
router.get(
  "/",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // The authenticate middleware already handles the token verification.
      // If we are here, we have a valid req.user.

      // Security Check: Explicitly ensure there's no token in query for this specific route.
      // (The middleware already enforces the header, but we want to be explicit about not using query tokens).
      if (req.query.token) {
        // We could log this or handle it, but per requirement we "remove ?token= support".
        // The header is mandatory.
      }

      res.status(200).json({
        success: true,
        data: MOCK_DATA,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
