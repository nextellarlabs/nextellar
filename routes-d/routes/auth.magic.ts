import { Router, type NextFunction, type Request, type Response } from "express";
import { buildMagicLinkUrl, consumeMagicLink, createMagicLink } from "../lib/magicLink.js";
import { SESSION_COOKIE_NAME, issueNextellarSession, sessionCookieOptions } from "../lib/session.js";

const router = Router();

function readAccountId(req: Request): string {
  return typeof req.body?.accountId === "string" ? req.body.accountId.trim() : "";
}

function readToken(req: Request): string {
  if (typeof req.body?.token === "string" && req.body.token.trim()) {
    return req.body.token.trim();
  }

  return typeof req.query.token === "string" ? req.query.token.trim() : "";
}

router.post(
  "/auth/magic/request",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accountId = readAccountId(req);
      const redirectTo = typeof req.body?.redirectTo === "string" ? req.body.redirectTo.trim() : undefined;

      if (!accountId) {
        res.status(400).json({ error: "accountId is required" });
        return;
      }

      const record = createMagicLink({ accountId, redirectTo });

      res.status(201).json({
        success: true,
        data: {
          accountId,
          tokenId: record.tokenId,
          expiresAt: record.expiresAt,
          magicLinkUrl: buildMagicLinkUrl(record),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/auth/magic/consume",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = readToken(req);

      if (!token) {
        res.status(400).json({ error: "token is required" });
        return;
      }

      const result = consumeMagicLink(token);

      if (!result) {
        res.status(401).json({ error: "invalid_or_expired_magic_link" });
        return;
      }

      res.cookie(SESSION_COOKIE_NAME, result.session.token, sessionCookieOptions());
      res.status(200).json({
        success: true,
        data: {
          accountId: result.accountId,
          sessionToken: result.session.token,
          sessionId: result.session.sessionId,
          expiresAt: result.session.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

export const magicLinkAuthDeps = {
  createMagicLink,
  consumeMagicLink,
  issueNextellarSession,
};
