import { Router, Request, Response, NextFunction } from 'express';
import { refreshTokenStore } from '../auth/refreshToken.js';

const router = Router();

/**
 * Exchange a presented refresh token for a fresh one.
 *
 * Status codes:
 *   - 200 on a successful rotation; the response contains the new
 *     token and its absolute expiry timestamp.
 *   - 400 when the request body is missing the token.
 *   - 401 when the token is unknown, expired, or already revoked.
 *   - 401 with the explicit `reuse_detected` reason when a rotated
 *     token is replayed — the entire family is revoked server-side
 *     before responding so the attacker's window closes immediately.
 */
router.post(
  '/auth/refresh',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const presented =
        typeof req.body?.refreshToken === 'string'
          ? req.body.refreshToken.trim()
          : '';

      if (!presented) {
        return res.status(400).json({ error: 'refreshToken is required' });
      }

      const result = refreshTokenStore.rotate(presented);

      if (!result.ok) {
        return res
          .status(401)
          .json({ error: 'invalid refresh token', reason: result.reason });
      }

      return res.status(200).json({
        refreshToken: result.result.token,
        expiresAt: result.result.expiresAt,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
