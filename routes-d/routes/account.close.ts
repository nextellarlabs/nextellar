import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type AccountCloseRequestBody = {
  confirm: boolean;
};

type AccountCloseRequest = {
  userId: string;
  scheduledDeletionAt: string;
  createdAt: string;
  cancelled: boolean;
};

type UserProfile = {
  id: string;
  email: string;
  lastAuthenticatedAt?: string;
};

// Mock database
const users = new Map<string, UserProfile>();
const closeRequests = new Map<string, AccountCloseRequest>();

const COOLDOWN_DAYS = 7;

/**
 * POST /account/close
 * Begin an account closure flow with a documented cooldown.
 */
router.post(
  "/account/close",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const body = req.body as AccountCloseRequestBody;

      // Validate confirm
      if (body.confirm === undefined || typeof body.confirm !== "boolean") {
        sendError(res, "INVALID_CONFIRMATION", "confirm is required and must be a boolean", 400);
        return;
      }

      if (!body.confirm) {
        sendError(res, "CONFIRMATION_REQUIRED", "You must confirm to close your account", 400);
        return;
      }

      const user = users.get(userId);

      if (!user) {
        sendError(res, "USER_NOT_FOUND", "Authenticated user profile not found", 404);
        return;
      }

      // Require fresh authentication (authenticated within last 5 minutes)
      const FRESH_AUTH_MINUTES = 5;
      if (!user.lastAuthenticatedAt) {
        sendError(res, "REAUTH_REQUIRED", "Fresh authentication required", 403);
        return;
      }

      const lastAuth = new Date(user.lastAuthenticatedAt);
      const now = new Date();
      const diffMs = now.getTime() - lastAuth.getTime();
      const diffMinutes = diffMs / (1000 * 60);

      if (diffMinutes > FRESH_AUTH_MINUTES) {
        sendError(res, "REAUTH_REQUIRED", "Fresh authentication required", 403);
        return;
      }

      // Check if there's already a pending close request
      const existingRequest = closeRequests.get(userId);

      if (existingRequest && !existingRequest.cancelled) {
        const scheduledDate = new Date(existingRequest.scheduledDeletionAt);
        const nowDate = new Date();
        
        if (scheduledDate > nowDate) {
          return res.status(200).json({
            success: true,
            data: {
              message: "Account closure already scheduled",
              scheduledDeletionAt: existingRequest.scheduledDeletionAt,
              cooldownDays: COOLDOWN_DAYS,
              canCancel: true,
            },
          });
        }
      }

      // Schedule deletion after cooldown
      const scheduledDeletionAt = new Date(
        Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const closeRequest: AccountCloseRequest = {
        userId,
        scheduledDeletionAt,
        createdAt: new Date().toISOString(),
        cancelled: false,
      };

      closeRequests.set(userId, closeRequest);

      // In a real implementation, this would schedule a background job
      // via the background scheduler to delete the account after the cooldown

      return res.status(201).json({
        success: true,
        data: {
          message: "Account closure scheduled",
          scheduledDeletionAt,
          cooldownDays: COOLDOWN_DAYS,
          canCancel: true,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getUsers(): Map<string, UserProfile> {
  return users;
}

export function __seedUser(user: UserProfile): void {
  users.set(user.id, user);
}

export function __getCloseRequests(): Map<string, AccountCloseRequest> {
  return closeRequests;
}

export function __resetAccountClose(): void {
  users.clear();
  closeRequests.clear();
}

export default router;
