// routes-d/routes/auth.register.ts
//
// POST /auth/register — new account registration with server-side CAPTCHA
// verification (Issue #267).
//
// Flow:
//   1. Validate the request body with registerSchema (email, password, name).
//   2. Verify the supplied captchaToken with the injected CaptchaVerifier.
//   3. Create the user account via the injected createUser dep.
//   4. Issue a session and return it.
//
// The CAPTCHA verifier and user-creation logic are injected so tests can
// mock both without real HTTP calls or a database.

import { Router, type Request, type Response } from 'express';
import { parseOrReject, registerSchema } from '../lib/schemas/auth.js';
import {
  type CaptchaVerifier,
  defaultCaptchaVerifier,
} from '../lib/captcha.js';
import { issueNextellarSession } from '../lib/session.js';
import { randomId } from '../lib/tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredUser {
  id: string;
  email: string;
  displayName: string;
}

export interface RegisterDeps {
  /** Server-side CAPTCHA verifier. */
  captcha: CaptchaVerifier;
  /**
   * Persist a new user record. Should throw if the email is already taken
   * (the route surfaces a 409 in that case).
   */
  createUser(params: {
    email: string;
    password: string;
    name: string;
    inviteCode?: string;
  }): Promise<RegisteredUser>;
}

// ---------------------------------------------------------------------------
// Default deps
// ---------------------------------------------------------------------------

export const defaultRegisterDeps: RegisterDeps = {
  captcha: defaultCaptchaVerifier,
  async createUser({ email, name }) {
    // Placeholder — replace with real DB call in production.
    return { id: randomId('usr'), email, displayName: name };
  },
};

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface CreateRegisterRouterOptions {
  deps?: RegisterDeps;
}

export function createRegisterRouter(opts: CreateRegisterRouterOptions = {}): Router {
  const router = Router();
  const deps = opts.deps ?? defaultRegisterDeps;

  router.post('/auth/register', async (req: Request, res: Response) => {
    // 1. Validate body schema (email, password, name, optional inviteCode).
    const body = parseOrReject(registerSchema, req.body, res);
    if (!body) return; // 400 already sent

    // 2. Require captchaToken in the raw body (not part of registerSchema).
    const captchaToken =
      typeof req.body?.captchaToken === 'string' ? req.body.captchaToken.trim() : '';
    if (!captchaToken) {
      res.status(400).json({
        error: 'validation_failed',
        fields: [{ field: 'captchaToken', message: 'required' }],
      });
      return;
    }

    // 3. Verify CAPTCHA server-side.
    const remoteIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress;

    const captchaResult = await deps.captcha.verify(captchaToken, remoteIp);
    if (!captchaResult.success) {
      res.status(400).json({
        error: 'captcha_failed',
        reason: captchaResult.reason ?? 'invalid_token',
      });
      return;
    }

    // 4. Create the user.
    let user: RegisteredUser;
    try {
      user = await deps.createUser({
        email: body.email,
        password: body.password,
        name: body.name,
        inviteCode: body.inviteCode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('already')) {
        res.status(409).json({ error: 'email_already_registered' });
        return;
      }
      res.status(500).json({ error: 'registration_failed' });
      return;
    }

    // 5. Issue session.
    const session = issueNextellarSession(user.id);

    res.status(201).json({
      ok: true,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  return router;
}

export default createRegisterRouter();
