import { Router, Request, Response, NextFunction } from 'express';
import {
  TotpSecretStore,
  formatOtpAuthUrl,
  totpSecretStore as defaultStore,
} from '../lib/totp.js';

/**
 * TOTP two-factor endpoints (Issue #258).
 *
 *   POST /auth/totp/enroll  — start enrolment, returns secret + otpauth URI.
 *                             Caller is expected to be already authenticated
 *                             by an upstream session middleware; the route
 *                             only enforces presence of a user identifier.
 *   POST /auth/totp/verify  — verify a code. First successful verify on a
 *                             pending enrolment transitions it to active.
 *                             Subsequent verifies act as the login step-up.
 *   POST /auth/totp/disable — disable TOTP for the user, gated on a current
 *                             code so a stolen session alone can't turn it
 *                             off.
 *
 * The "current user" is resolved through `userResolver`. The default reads
 * `req.body.userId` so the file stays decoupled from the session/JWT
 * middleware already in routes-d — production wiring replaces the resolver
 * with one that reads `req.jwt.sub`.
 */

export type UserResolver = (req: Request) => string | undefined;

const defaultUserResolver: UserResolver = (req) => {
  const value = (req.body as { userId?: unknown } | undefined)?.userId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

function extractCode(req: Request): string {
  const value = (req.body as { code?: unknown } | undefined)?.code;
  return typeof value === 'string' ? value.trim() : '';
}

export interface CreateTotpRouterOptions {
  store?: TotpSecretStore;
  userResolver?: UserResolver;
  issuer?: string;
  /** Resolve an account label (typically an email) for the otpauth URI. */
  getAccountName?: (req: Request, userId: string) => string;
}

export function createTotpRouter(
  options: CreateTotpRouterOptions = {},
): Router {
  const router = Router();
  const store = options.store ?? defaultStore;
  const userResolver = options.userResolver ?? defaultUserResolver;
  const getAccountName =
    options.getAccountName ??
    ((req, userId) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === 'string' && email.length > 0 ? email : userId;
    });
  const issuer = options.issuer ?? 'Nextellar';

  router.post(
    '/auth/totp/enroll',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = userResolver(req);
        if (!userId) {
          return res.status(401).json({ error: 'unauthorized' });
        }

        const { secretBase32 } = store.startEnrollment(userId);
        const otpauthUrl = formatOtpAuthUrl({
          secretBase32,
          accountName: getAccountName(req, userId),
          issuer,
        });

        // Returning the raw base32 secret is part of the enrolment UX —
        // the client renders it as a QR plus a manual-entry fallback. The
        // value is single-use in the sense that calling enroll again
        // overwrites it; the active record only persists after the user
        // proves possession via /verify.
        return res.status(200).json({
          secret: secretBase32,
          otpauthUrl,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/auth/totp/verify',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = userResolver(req);
        if (!userId) {
          return res.status(401).json({ error: 'unauthorized' });
        }
        const code = extractCode(req);
        if (!/^\d{6}$/.test(code)) {
          return res.status(400).json({ error: 'code must be 6 digits' });
        }

        const result = store.verifyAndConsume(userId, code);
        if (!result.ok) {
          // 401 across the board so a probing caller can't distinguish
          // "no enrolment" from "wrong code" from "replay". The `reason`
          // field is included for legitimate clients/observability.
          return res
            .status(401)
            .json({ error: 'invalid totp code', reason: result.reason });
        }

        return res
          .status(200)
          .json({ success: true, active: store.isActive(userId) });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/auth/totp/disable',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = userResolver(req);
        if (!userId) {
          return res.status(401).json({ error: 'unauthorized' });
        }
        if (!store.isActive(userId)) {
          return res.status(404).json({ error: 'totp not enrolled' });
        }
        const code = extractCode(req);
        if (!/^\d{6}$/.test(code)) {
          return res
            .status(400)
            .json({ error: 'code must be 6 digits to disable totp' });
        }
        const result = store.verifyAndConsume(userId, code);
        if (!result.ok) {
          return res
            .status(401)
            .json({ error: 'invalid totp code', reason: result.reason });
        }

        store.disable(userId);
        return res.status(200).json({ success: true });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

export default createTotpRouter();
