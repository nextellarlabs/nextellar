import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import { screenDestination } from "../lib/sanctionsScreening.js";

const router = Router();

type ScreenPaymentBody = {
  destination: string;
};

router.post(
  "/payments/screen",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const body = req.body as ScreenPaymentBody;

      if (!body.destination || typeof body.destination !== "string") {
        sendError(res, "INVALID_DESTINATION", "destination is required and must be a string", 400);
        return;
      }

      const result = await screenDestination(body.destination.trim());

      if (result.status === "error") {
        sendError(res, "SCREENING_UNAVAILABLE", "Sanctions list source is currently unavailable", 503);
        return;
      }

      if (result.status === "hit") {
        sendError(
          res,
          "SANCTIONS_HIT",
          `Destination is listed on a sanctions list (${result.matchedList})`,
          403,
        );
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          destination: result.destination,
          status: result.status,
          timestamp: result.timestamp,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
