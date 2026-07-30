import { Router, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.js";
import { validateCsrf } from "../middleware/csrf.js";
import { sendError } from "../utils/response.js";

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
        sendError(res, 'MISSING_FIELD', 'Password confirmation required', 400);
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
