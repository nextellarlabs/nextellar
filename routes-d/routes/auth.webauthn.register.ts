import { Router, Request, Response, NextFunction } from 'express';
import {
  buildRegistrationClientData,
  verifyRegistrationResponse,
  webAuthnStore,
} from '../auth/webauthnService.js';

const router = Router();

/**
 * Begin WebAuthn passkey registration and verify attestation server-side.
 */
router.post(
  '/auth/webauthn/register/options',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const challenge = webAuthnStore.createChallenge(userId, 'registration');
      const existingCredentials = webAuthnStore.getUserCredentials(userId);

      return res.status(200).json({
        success: true,
        data: {
          challenge,
          rp: { name: 'Nextellar', id: 'nextellar.dev' },
          user: { id: userId, name: userId, displayName: userId },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          excludeCredentials: existingCredentials.map((c) => ({
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
  '/auth/webauthn/register',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
      const credentialName =
        typeof req.body?.credentialName === 'string'
          ? req.body.credentialName.trim()
          : '';
      const challenge =
        typeof req.body?.challenge === 'string' ? req.body.challenge.trim() : '';
      const credential = req.body?.credential;

      if (!userId || !credentialName || !challenge || !credential) {
        return res.status(400).json({
          error: 'userId, credentialName, challenge, and credential are required',
        });
      }

      const result = verifyRegistrationResponse(
        userId,
        credentialName,
        credential,
        challenge,
      );

      if (!result.verified) {
        return res.status(400).json({ error: result.error ?? 'Registration failed' });
      }

      return res.status(201).json({
        success: true,
        data: {
          credentialId: result.credentialId,
          name: credentialName,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export { buildRegistrationClientData };
export default router;
