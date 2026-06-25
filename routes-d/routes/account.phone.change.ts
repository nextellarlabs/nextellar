import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PhoneChangeRequestBody = {
  newPhone: string;
  otp: string;
};

type PhoneChangeRequest = {
  userId: string;
  oldPhone: string;
  newPhone: string;
  verified: boolean;
  createdAt: string;
};

type UserProfile = {
  id: string;
  phone: string;
  lastAuthenticatedAt?: string;
};

// Mock database
const users = new Map<string, UserProfile>();
const phoneChangeRequests = new Map<string, PhoneChangeRequest>();

const OTP_EXPIRY_MINUTES = 10;

/**
 * POST /account/phone/change
 * Change the verified phone number on a Nextellar account.
 */
router.post(
  "/account/phone/change",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const body = req.body as PhoneChangeRequestBody;

      // Validate newPhone
      if (!body.newPhone || typeof body.newPhone !== "string") {
        sendError(res, "INVALID_PHONE", "newPhone is required and must be a string", 400);
        return;
      }

      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      if (!phoneRegex.test(body.newPhone)) {
        sendError(res, "INVALID_PHONE", "newPhone must be a valid phone number in E.164 format", 400);
        return;
      }

      // Validate OTP
      if (!body.otp || typeof body.otp !== "string") {
        sendError(res, "INVALID_OTP", "OTP is required and must be a string", 400);
        return;
      }

      if (body.otp.length !== 6) {
        sendError(res, "INVALID_OTP", "OTP must be 6 digits", 400);
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

      // Check if new phone is the same as current phone
      if (user.phone === body.newPhone) {
        sendError(res, "SAME_PHONE", "New phone cannot be the same as current phone", 400);
        return;
      }

      // Check if there's already a pending change request
      const existingRequest = Array.from(phoneChangeRequests.values()).find(
        (req) => req.userId === userId && !req.verified
      );

      if (existingRequest) {
        sendError(res, "PENDING_CHANGE_EXISTS", "A phone change request is already pending", 409);
        return;
      }

      // Verify OTP (mock verification - in real implementation would validate against SMS service)
      const validOtpPattern = /^\d{6}$/;
      if (!validOtpPattern.test(body.otp)) {
        sendError(res, "INVALID_OTP", "Invalid OTP", 400);
        return;
      }

      // Create phone change request
      const changeRequest: PhoneChangeRequest = {
        userId,
        oldPhone: user.phone,
        newPhone: body.newPhone,
        verified: true, // OTP verified, ready to apply
        createdAt: new Date().toISOString(),
      };

      phoneChangeRequests.set(userId, changeRequest);

      // Apply the change immediately after OTP verification
      user.phone = body.newPhone;

      return res.status(200).json({
        success: true,
        data: {
          oldPhone: changeRequest.oldPhone,
          newPhone: body.newPhone,
          changedAt: changeRequest.createdAt,
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

export function __getPhoneChangeRequests(): Map<string, PhoneChangeRequest> {
  return phoneChangeRequests;
}

export function __resetPhoneChange(): void {
  users.clear();
  phoneChangeRequests.clear();
}

export default router;
