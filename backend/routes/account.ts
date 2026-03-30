import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { validateCsrf } from "../middleware/csrf.js";

const router = Router();

/**
 * POST /account/delete
 * Deletes the authenticated user's account. Protected by CSRF and auth.
 */
router.post(
  "/delete",
  authenticate,
  validateCsrf,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { confirmPassword } = req.body;
      
      if (!confirmPassword) {
        res.status(400).json({ error: "Password confirmation required" });
        return;
      }

      // Mock account deletion
      res.status(200).json({
        success: true,
        message: "Account deletion requested successfully",
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
