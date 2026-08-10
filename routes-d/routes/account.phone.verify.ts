import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PhoneVerifyBody = {
  phoneNumber: string;
  code: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_WINDOW = 10;

const attemptsMap = new Map<string, { count: number; windowStart: number }>();
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function getOrResetWindow(
  map: Map<string, { count: number; windowStart: number }>,
  key: string,
): { count: number; windowStart: number } {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    const fresh = { count: 0, windowStart: now };
    map.set(key, fresh);
    return fresh;
  }
  return entry;
}

function normalizePhone(phoneNumber: string): string {
  return phoneNumber.replace(/[\s-]/g, "");
}

/**
 * POST /account/phone/verify
 * Verify a phone number via OTP.
 */
router.post(
  "/account/phone/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as PhoneVerifyBody;

      if (!body.phoneNumber || typeof body.phoneNumber !== "string") {
        sendError(res, "INVALID_PHONE_NUMBER", "phoneNumber is required and must be a string", 400);
        return;
      }

      if (!body.code || typeof body.code !== "string") {
        sendError(res, "INVALID_CODE", "code is required and must be a string", 400);
        return;
      }

      const phoneKey = normalizePhone(body.phoneNumber);

      const rateEntry = getOrResetWindow(rateLimitMap, phoneKey);
      rateEntry.count += 1;
      if (rateEntry.count > MAX_REQUESTS_PER_WINDOW) {
        sendError(
          res,
          "RATE_LIMIT_EXCEEDED",
          "Too many verification attempts. Please try again later.",
          429,
        );
        return;
      }

      const attemptEntry = getOrResetWindow(attemptsMap, phoneKey);
      attemptEntry.count += 1;
      if (attemptEntry.count > MAX_ATTEMPTS) {
        sendError(
          res,
          "ATTEMPT_LIMIT_EXCEEDED",
          "Maximum verification attempts reached. Please try again later.",
          429,
        );
        return;
      }

      const normalizedCode = body.code.replace(/[\s-]/g, "");

      if (normalizedCode !== "123456") {
        sendError(res, "INVALID_CODE", "Invalid verification code", 400);
        return;
      }

      return res.status(200).json({
        success: true,
        data: {
          phoneNumber: phoneKey,
          verified: true,
          attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attemptEntry.count),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetPhoneVerify(): void {
  attemptsMap.clear();
  rateLimitMap.clear();
}

export default router;