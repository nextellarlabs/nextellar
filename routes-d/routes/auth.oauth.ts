// routes-d/routes/auth.oauth.ts
//
// OAuth provider sign-in flow (Issue #260).
//
// Two endpoints:
//
//   GET  /auth/oauth/start?provider=<name>
//        Redirect the browser to the provider's authorization URL.
//
//   GET  /auth/oauth/callback?provider=<name>&code=<code>&state=<state>
//        Exchange the authorization code for a provider access token,
//        fetch the user profile, map it to a Nextellar account via
//        identity.ts, and issue a session.
//
// All provider-specific logic (token exchange, profile fetch) is injected
// via `OAuthProviderAdapter` so tests can mock the exchange without real
// HTTP calls.

import { Router, type Request, type Response } from 'express';
import { findOrCreateUser, type OAuthProfile } from '../lib/identity.js';
import { issueNextellarSession, sessionCookieOptions } from '../lib/session.js';
import { randomId } from '../lib/tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface OAuthProviderAdapter {
  /** Human-readable provider name, e.g. "github". */
  name: string;
  /**
   * Build the authorization URL the browser should be redirected to.
   * `state` is a CSRF-prevention nonce generated per request.
   */
  buildAuthUrl(state: string): string;
  /**
   * Exchange an authorization code for provider tokens.
   * Returns null when the exchange fails (bad code, expired, etc.).
   */
  exchangeCode(code: string): Promise<OAuthTokens | null>;
  /**
   * Fetch the authenticated user's profile from the provider.
   * Returns null when the access token is invalid.
   */
  fetchProfile(accessToken: string): Promise<OAuthProfile | null>;
}

export interface OAuthRouterDeps {
  /** Map of provider name → adapter. */
  providers: Map<string, OAuthProviderAdapter>;
  /** Injectable session issuer for testing. */
  issueSession?: typeof issueNextellarSession;
  /** Injectable identity resolver for testing. */
  resolveIdentity?: typeof findOrCreateUser;
  /** Injectable state generator for testing. */
  generateState?: () => string;
}

// ---------------------------------------------------------------------------
// In-memory state store (CSRF nonce per request)
// ---------------------------------------------------------------------------

/** Keyed by state nonce; value is the provider name. */
export const oauthStateStore = new Map<string, { provider: string; expiresAt: number }>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [key, val] of oauthStateStore) {
    if (val.expiresAt < now) oauthStateStore.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();
  const issueSession = deps.issueSession ?? issueNextellarSession;
  const resolveIdentity = deps.resolveIdentity ?? findOrCreateUser;
  const generateState = deps.generateState ?? (() => randomId('oauth'));

  // GET /auth/oauth/start?provider=<name>
  router.get('/auth/oauth/start', (req: Request, res: Response) => {
    const providerName =
      typeof req.query.provider === 'string' ? req.query.provider.trim() : '';

    const adapter = deps.providers.get(providerName);
    if (!adapter) {
      res.status(400).json({ error: 'unknown_provider', provider: providerName || undefined });
      return;
    }

    pruneExpiredStates();
    const state = generateState();
    oauthStateStore.set(state, { provider: providerName, expiresAt: Date.now() + STATE_TTL_MS });

    const authUrl = adapter.buildAuthUrl(state);
    res.redirect(302, authUrl);
  });

  // GET /auth/oauth/callback?provider=<name>&code=<code>&state=<state>
  router.get('/auth/oauth/callback', async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const providerName =
      typeof req.query.provider === 'string' ? req.query.provider.trim() : '';

    if (!code || !state) {
      res.status(400).json({ error: 'code and state are required' });
      return;
    }

    // Validate state (CSRF check).
    const stateRecord = oauthStateStore.get(state);
    if (!stateRecord || stateRecord.expiresAt < Date.now()) {
      oauthStateStore.delete(state);
      res.status(400).json({ error: 'invalid_or_expired_state' });
      return;
    }

    // Use provider from state record (more trustworthy than query param).
    const resolvedProvider = stateRecord.provider;
    if (providerName && providerName !== resolvedProvider) {
      res.status(400).json({ error: 'provider_mismatch' });
      return;
    }

    oauthStateStore.delete(state);

    const adapter = deps.providers.get(resolvedProvider);
    if (!adapter) {
      res.status(400).json({ error: 'unknown_provider' });
      return;
    }

    // Exchange code for tokens.
    const tokens = await adapter.exchangeCode(code);
    if (!tokens) {
      res.status(401).json({ error: 'code_exchange_failed' });
      return;
    }

    // Fetch provider profile.
    const profile = await adapter.fetchProfile(tokens.accessToken);
    if (!profile) {
      res.status(401).json({ error: 'profile_fetch_failed' });
      return;
    }

    // Map to Nextellar user.
    const { user, isNew } = resolveIdentity(profile);

    // Issue session.
    const session = issueSession(user.id);
    res.cookie('session', session.token, sessionCookieOptions());

    res.status(200).json({
      ok: true,
      isNew,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  return router;
}
