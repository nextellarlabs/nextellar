import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type EmailChangeRequestBody = {
  newEmail: string;
};

type EmailChangeRequest = {
  userId: string;
  oldEmail: string;
  newEmail: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  verified: boolean;
};

type UserProfile = {
  id: string;
  email: string;
};

// Mock database
const users = new Map<string, UserProfile>();
const emailChangeRequests = new Map<string, EmailChangeRequest>();

const TOKEN_EXPIRY_HOURS = 24;

/**
 * POST /account/email/change
 * Begin an email change flow with verification.
 */
router.post(
  "/account/email/change",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const body = req.body as EmailChangeRequestBody;

      // Validate newEmail
      if (!body.newEmail || typeof body.newEmail !== "string") {
        sendError(res, "INVALID_EMAIL", "newEmail is required and must be a string", 400);
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.newEmail)) {
        sendError(res, "INVALID_EMAIL", "newEmail must be a valid email address", 400);
        return;
      }

      const user = users.get(userId);

      if (!user) {
        sendError(res, "USER_NOT_FOUND", "Authenticated user profile not found", 404);
        return;
      }

      // Check if new email is the same as current email
      if (user.email === body.newEmail) {
        sendError(res, "SAME_EMAIL", "New email cannot be the same as current email", 400);
        return;
      }

      // Check if there's already a pending change request
      const existingRequest = Array.from(emailChangeRequests.values()).find(
        (req) => req.userId === userId && !req.verified
      );

      if (existingRequest) {
        sendError(res, "PENDING_CHANGE_EXISTS", "An email change request is already pending", 409);
        return;
      }

      // Generate verification token
      const token = generateToken();

      // Create email change request
      const changeRequest: EmailChangeRequest = {
        userId,
        oldEmail: user.email,
        newEmail: body.newEmail,
        token,
        expiresAt: new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        verified: false,
      };

      emailChangeRequests.set(token, changeRequest);

      // In a real implementation, this would send an email with the verification token
      // For now, we return the token in the response for testing purposes

      return res.status(201).json({
        success: true,
        data: {
          newEmail: body.newEmail,
          token,
          expiresAt: changeRequest.expiresAt,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

function generateToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function __getUsers(): Map<string, UserProfile> {
  return users;
}

export function __seedUser(user: UserProfile): void {
  users.set(user.id, user);
}

export function __getEmailChangeRequests(): Map<string, EmailChangeRequest> {
  return emailChangeRequests;
}

export function __resetEmailChange(): void {
  users.clear();
  emailChangeRequests.clear();
}

export default router;
