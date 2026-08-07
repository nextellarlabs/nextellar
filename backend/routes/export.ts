import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { sendError } from "../utils/response.js";

const router = Router();

/**
 * GET /export
 * Returns an export of the authenticated user's data.
 *
 * Auth is accepted only via the `Authorization: Bearer <token>` header.
 * A `?token=` query string is intentionally never read: query strings are
 * recorded in server access logs, browser history, proxy logs, and
 * Referer headers, which would persistently leak the auth token outside
 * the app's control. `authenticate` returns 401 when the header is
 * missing or the token is invalid.
 */
router.get(
  "/export",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Unauthorized", 401);
        return;
      }

      const data = await getExportData(userId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Stub - swap out for your actual service / DB layer
// ---------------------------------------------------------------------------
export async function getExportData(
  userId: string,
): Promise<{ userId: string; generatedAt: string; records: unknown[] }> {
  return { userId, generatedAt: new Date().toISOString(), records: [] };
}
