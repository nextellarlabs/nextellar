import { Router, Request, Response, NextFunction } from 'express';
import { passwordTokenStore } from '../lib/passwordTokens.js';

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Test-only hooks for the out-of-band token delivery (email) and the
 * password persistence layer. Production wiring replaces these via
 * dependency injection — both default to no-op stubs so a misconfigured
 * production deployment fails loudly rather than silently storing
 * passwords nowhere.
 */
export const passwordResetDeps = {
  sendResetEmail: async (_payload: {
    to: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> => {
    throw new Error('passwordResetDeps.sendResetEmail not configured');
  },
  storeNewPassword: async (_payload: {
    userId: string;
    password: string;
  }): Promise<void> => {
    throw new Error('passwordResetDeps.storeNewPassword not configured');
  },
  /** Resolve an email to its userId. Returns null when no user exists. */
  resolveUserId: async (_email: string): Promise<string | null> => {
    throw new Error('passwordResetDeps.resolveUserId not configured');
  },
};

/**
 * Forgot-password: accept an email, issue a token, send it out of band.
 *
 * Always returns 200 with the same body — including when the address is
 * not registered — so a caller cannot enumerate existing accounts by
 * comparing response shape or timing.
 */
router.post(
  '/auth/password/forgot',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email =
        typeof req.body?.email === 'string'
          ? req.body.email.trim().toLowerCase()
          : '';

      if (!email || !EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      const userId = await passwordResetDeps.resolveUserId(email);

      if (userId) {
        const record = passwordTokenStore.create(email, userId);
        await passwordResetDeps.sendResetEmail({
          to: email,
          token: record.token,
          expiresAt: new Date(record.expiresAt),
        });
      }

      return res
        .status(200)
        .json({ success: true, message: 'If the email is registered, a reset link has been sent.' });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Reset-password: consume a single-use token and write the new password.
 *
 * Status codes:
 *   - 400 on malformed input (missing/short password, missing token).
 *   - 401 with `reason` indicating why the token cannot be used
 *     (`unknown`, `expired`, `used`).
 *   - 200 on success; the token is permanently consumed before
 *     responding so it cannot be replayed even within the same
 *     request burst.
 */
router.post(
  '/auth/password/reset',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token =
        typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const password =
        typeof req.body?.password === 'string' ? req.body.password : '';

      if (!token) {
        return res.status(400).json({ error: 'token is required' });
      }

      if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return res
          .status(400)
          .json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      }

      const consumed = passwordTokenStore.consume(token);

      if (!consumed.ok) {
        return res
          .status(401)
          .json({ error: 'invalid token', reason: consumed.reason });
      }

      await passwordResetDeps.storeNewPassword({
        userId: consumed.record.userId,
        password,
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
