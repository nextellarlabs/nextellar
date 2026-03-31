import { Router, Request, Response, NextFunction } from "express";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "../middleware/session.js";

const router = Router();

const MAX_LOGIN_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

type RateLimitBucket = {
  attempts: number;
  resetAt: number;
};

const ipBuckets = new Map<string, RateLimitBucket>();
const usernameBuckets = new Map<string, RateLimitBucket>();

type AuthDependencies = {
  authenticateUser: (
    username: string,
    password: string,
  ) => Promise<{ userId: string; token: string } | null>;
};

export const authDeps: AuthDependencies = {
  authenticateUser: async (username: string, password: string) => {
    void username;
    void password;
    return null;
  },
};

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function getClientIp(req: Request): string {
  const forwardedFor = req.header("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0];
    if (firstIp) {
      return firstIp.trim();
    }
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

function getBucket(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  now: number,
): RateLimitBucket {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const replacement = { attempts: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    buckets.set(key, replacement);
    return replacement;
  }
  return existing;
}

function incrementBucket(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  now: number,
): RateLimitBucket {
  const bucket = getBucket(buckets, key, now);
  bucket.attempts += 1;
  return bucket;
}

function clearBucket(buckets: Map<string, RateLimitBucket>, key: string): void {
  buckets.delete(key);
}

function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

export function __resetLoginRateLimitState(): void {
  ipBuckets.clear();
  usernameBuckets.clear();
}

/**
 * Allowlist of valid redirect paths. Only relative paths that start
 * with "/" are accepted. External or absolute URLs are rejected.
 */
const ALLOWED_REDIRECT_PATHS = [
  "/",
  "/dashboard",
  "/settings",
  "/profile",
  "/transactions",
];

/**
 * Returns a safe redirect target. Rejects absolute URLs, external hosts,
 * protocol-relative URLs, and paths not on the allowlist.
 * Falls back to "/" for anything invalid.
 */
export function sanitizeRedirect(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "/";
  }

  const trimmed = raw.trim();

  // Reject protocol-relative URLs (//evil.com)
  if (trimmed.startsWith("//")) {
    return "/";
  }

  // Reject absolute URLs (http://, https://, or any scheme)
  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return "/";
    }
  } catch {
    return "/";
  }

  // Only allow paths on the explicit allowlist
  if (!ALLOWED_REDIRECT_PATHS.includes(trimmed)) {
    return "/";
  }

  return trimmed;
}

/**
 * GET /auth/callback
 * Handles the OAuth callback redirect. Validates the redirect query
 * parameter against an allowlist before redirecting.
 */
router.get("/auth/callback", (req: Request, res: Response) => {
  const target = sanitizeRedirect(req.query.redirect);
  res.redirect(target);
});

router.post(
  "/auth/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawUsername =
        typeof req.body?.username === "string" ? req.body.username : "";
      const password =
        typeof req.body?.password === "string" ? req.body.password : "";

      if (!rawUsername || !password) {
        return res.status(400).json({
          success: false,
          message: "username and password are required",
        });
      }

      const username = normalizeUsername(rawUsername);
      const ip = getClientIp(req);
      const now = Date.now();

      const ipBucket = getBucket(ipBuckets, ip, now);
      const userBucket = getBucket(usernameBuckets, username, now);

      if (
        ipBucket.attempts >= MAX_LOGIN_ATTEMPTS ||
        userBucket.attempts >= MAX_LOGIN_ATTEMPTS
      ) {
        const resetAt =
          ipBucket.attempts >= MAX_LOGIN_ATTEMPTS
            ? ipBucket.resetAt
            : userBucket.resetAt;
        res.setHeader("Retry-After", retryAfterSeconds(resetAt, now).toString());
        return res.status(429).json({
          success: false,
          message: "Too many login attempts. Please retry later.",
        });
      }

      const authResult = await authDeps.authenticateUser(username, password);

      if (authResult) {
        clearBucket(ipBuckets, ip);
        clearBucket(usernameBuckets, username);
        res.cookie(
          SESSION_COOKIE_NAME,
          authResult.token,
          sessionCookieOptions(),
        );
        return res.status(200).json({ success: true, data: authResult });
      }

      incrementBucket(ipBuckets, ip, now);
      incrementBucket(usernameBuckets, username, now);

      const logEntry = {
        timestamp: new Date().toISOString(),
        ip,
        username: username.substring(0, 64),
        reason: "invalid_credentials",
      };
      console.log(`[AUTH_FAILURE] ${JSON.stringify(logEntry)}`);

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
