import { Router, Request, Response, NextFunction } from 'express';
import {
  loginRateLimit,
  type LoginRateLimitOptions,
} from '../middleware/rateLimit.js';

/**
 * Login route with rate limiting baked in (Issue #256).
 *
 * The credential check and token issuance are injected via `loginDeps` so
 * the route file stays storage-agnostic — a production wiring replaces the
 * defaults, which throw on call so a misconfigured deployment fails loud
 * rather than silently accepting requests.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface LoginVerificationResult {
  /** Stable user identifier on success. */
  userId: string;
  /**
   * Set when the account has TOTP enabled. The caller must complete the
   * step-up via the TOTP routes (Issue #258) before being granted a full
   * session.
   */
  totpRequired?: boolean;
}

export interface LoginDeps {
  /**
   * Verify a (email, password) pair. Return `null` on any failure — never
   * differentiate between "no such user" and "wrong password" so callers
   * can't probe for valid accounts.
   */
  verifyCredentials: (input: {
    email: string;
    password: string;
  }) => Promise<LoginVerificationResult | null>;
  /** Issue the session token for an authenticated user. */
  issueSession: (input: {
    userId: string;
    email: string;
  }) => Promise<{ token: string; expiresAt: number }>;
}

export const loginDeps: LoginDeps = {
  verifyCredentials: async () => {
    throw new Error('loginDeps.verifyCredentials not configured');
  },
  issueSession: async () => {
    throw new Error('loginDeps.issueSession not configured');
  },
};

export interface CreateLoginRouterOptions {
  rateLimit?: LoginRateLimitOptions;
  deps?: LoginDeps;
}

/**
 * Build a router instance. Exposed so tests can supply fake deps and a
 * deterministic limiter without monkey-patching the module-level singleton.
 */
export function createLoginRouter(
  options: CreateLoginRouterOptions = {},
): Router {
  const router = Router();
  const deps = options.deps ?? loginDeps;
  const limiter = loginRateLimit(options.rateLimit);

  router.post(
    '/auth/login',
    limiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const email =
          typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : '';
        const password =
          typeof req.body?.password === 'string' ? req.body.password : '';

        if (!email || !EMAIL_PATTERN.test(email)) {
          return res.status(400).json({ error: 'Invalid email address' });
        }
        if (!password || password.length < MIN_PASSWORD_LENGTH) {
          return res
            .status(400)
            .json({
              error: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            });
        }

        const verified = await deps.verifyCredentials({ email, password });
        if (!verified) {
          return res.status(401).json({ error: 'invalid credentials' });
        }

        if (verified.totpRequired) {
          // The credential pair is good but the account has a second factor
          // enabled. We deliberately do not issue a usable session here —
          // the client must POST to /auth/totp/verify next.
          return res.status(200).json({
            userId: verified.userId,
            totpRequired: true,
          });
        }

        const session = await deps.issueSession({
          userId: verified.userId,
          email,
        });
        return res.status(200).json({
          userId: verified.userId,
          token: session.token,
          expiresAt: session.expiresAt,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

/** Default router wired against the singleton deps. */
export default createLoginRouter();
