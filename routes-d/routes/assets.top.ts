import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import { getTopAssets, type WindowSize } from "../lib/volumeRollup.js";

const router = Router();

const VALID_WINDOWS = new Set<WindowSize>(["24h", "7d", "30d"]);

router.get(
  "/assets/top",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const window = (req.query.window as string) ?? "24h";

      if (!VALID_WINDOWS.has(window as WindowSize)) {
        sendError(
          res,
          "INVALID_WINDOW",
          "window must be one of: 24h, 7d, 30d",
          400,
        );
        return;
      }

      const result = getTopAssets(window as WindowSize);

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
