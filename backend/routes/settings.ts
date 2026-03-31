import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { validateCsrf } from "../middleware/csrf.js";

const router = Router();

/**
 * POST /settings/update
 * Updates user settings. Protected by authentication and CSRF middleware.
 */
router.post(
  "/update",
  authenticate,
  validateCsrf,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { theme, notifications } = req.body;
      
      // Mock update logic
      res.status(200).json({
        success: true,
        message: "Settings updated successfully",
        data: { theme, notifications }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
