import { Router, type Request, type Response } from 'express';
import {
  issueChallenge,
  verifyChallenge,
  type SignatureVerifier,
} from '../auth/walletChallenge.js';
import {
  issueNextellarSession,
  sessionCookieOptions,
} from '../lib/session.js';

/**
 * Express router for the Stellar wallet challenge-response authentication flow.
 *
 * GET  /auth/wallet/challenge?account=<hex-pubkey>
 *      Issues a time-bound nonce for the given public key.
 *
 * POST /auth/wallet/verify  { nonce: string, signature: string }
 *      Verifies the signed nonce, then issues a session cookie.
 *
 * The `SignatureVerifier` is injected so tests can supply a deterministic
 * verifier without spawning real cryptographic operations.
 */

export interface WalletAuthRouterOptions {
  verify?: SignatureVerifier;
}

export function createWalletAuthRouter(options: WalletAuthRouterOptions = {}): Router {
  const router = Router();

  // GET /auth/wallet/challenge?account=<hex-pubkey>
  router.get('/auth/wallet/challenge', (req: Request, res: Response) => {
    const account =
      typeof req.query.account === 'string' ? req.query.account.trim() : '';
    if (!account) {
      return res.status(400).json({ error: 'account query param required' });
    }
    try {
      const nonce = issueChallenge(account);
      return res.status(200).json({ nonce });
    } catch {
      return res.status(400).json({ error: 'invalid_account' });
    }
  });

  // POST /auth/wallet/verify
  router.post('/auth/wallet/verify', (req: Request, res: Response) => {
    const nonce =
      typeof req.body?.nonce === 'string' ? req.body.nonce.trim() : '';
    const signature =
      typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';

    if (!nonce || !signature) {
      return res
        .status(400)
        .json({ error: 'nonce and signature are required' });
    }

    const result = verifyChallenge(nonce, signature, options.verify);

    if (!result.ok) {
      return res.status(401).json({ error: result.reason });
    }

    const session = issueNextellarSession(result.publicKey);
    res.cookie('session', session.token, sessionCookieOptions());
    return res.status(200).json({
      token: session.token,
      expiresAt: session.expiresAt,
      accountId: session.accountId,
    });
  });

  return router;
}

export default createWalletAuthRouter();