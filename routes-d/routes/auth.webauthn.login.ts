import { Router, Request, Response, NextFunction } from 'express';
import {
  buildAuthenticationClientData,
  verifyAuthenticationResponse,
  webAuthnStore,
} from '../auth/webauthnService.js';

const router = Router();

/**
 * Begin WebAuthn passkey login and verify assertion server-side.
 */
router.post(
  '/auth/webauthn/login/options',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const credentials = webAuthnStore.getUserCredentials(userId);
      if (credentials.length === 0) {
        return res.status(404).json({ error: 'No passkeys registered for user' });
      }

      const challenge = webAuthnStore.createChallenge(userId, 'authentication');

      return res.status(200).json({
        success: true,
        data: {
          challenge,
          allowCredentials: credentials.map((c) => ({
            type: 'public-key',
            id: c.credentialId,
          })),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  '/auth/webauthn/login',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
      const challenge =
        typeof req.body?.challenge === 'string' ? req.body.challenge.trim() : '';
      const credential = req.body?.credential;

      if (!userId || !challenge || !credential) {
        return res.status(400).json({
          error: 'userId, challenge, and credential are required',
        });
      }

      const result = verifyAuthenticationResponse(userId, credential, challenge);

      if (!result.verified) {
        return res.status(401).json({ error: result.error ?? 'Authentication failed' });
      }

      return res.status(200).json({
        success: true,
        data: { userId, authenticated: true },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export { buildAuthenticationClientData };
export default router;
