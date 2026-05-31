import { Router, Request, Response, NextFunction } from 'express';
import { emailDispatcherDeps } from '../lib/emailDispatcher.js';
import { verificationTokenStore } from '../lib/verificationTokenStore.js';

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Request an email verification token (sent out-of-band via email dispatcher).
 */
router.post(
  '/auth/email/verify/request',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const userId =
        typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';

      if (!email || !userId) {
        return res.status(400).json({ error: 'email and userId are required' });
      }

      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      const record = verificationTokenStore.createToken(email, userId);

      await emailDispatcherDeps.sendVerificationEmail({
        to: email,
        token: record.token,
        expiresAt: new Date(record.expiresAt),
      });

      return res.status(200).json({
        success: true,
        message: 'Verification email sent',
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Confirm an email address with a single-use token (valid for 24 hours).
 */
router.post(
  '/auth/email/verify/confirm',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token =
        typeof req.body?.token === 'string' ? req.body.token.trim() : '';

      if (!token) {
        return res.status(400).json({ error: 'token is required' });
      }

      const record = verificationTokenStore.getToken(token);

      if (!record) {
        return res.status(400).json({ error: 'Invalid verification token' });
      }

      if (record.used) {
        return res.status(400).json({ error: 'Verification token already used' });
      }

      if (verificationTokenStore.isExpired(record)) {
        return res.status(400).json({ error: 'Verification token expired' });
      }

      verificationTokenStore.markUsed(token);

      return res.status(200).json({
        success: true,
        data: {
          email: record.email,
          userId: record.userId,
          verified: true,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
