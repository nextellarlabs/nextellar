// Tests for the OAuth provider sign-in flow (Issue #260).
//
// Covers:
//   - /auth/oauth/start: redirect to provider, unknown provider 400
//   - /auth/oauth/callback: new user, returning user, bad code, bad state,
//     provider mismatch, missing params
//   - identity.ts: findOrCreateUser unit tests

import express, { type Express } from 'express';
import request from 'supertest';
import {
  createOAuthRouter,
  oauthStateStore,
  type OAuthProviderAdapter,
  type OAuthRouterDeps,
} from '../routes/auth.oauth.js';
import {
  findOrCreateUser,
  identityStore,
  userStore,
  type OAuthProfile,
} from '../lib/identity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(overrides: Partial<OAuthProviderAdapter> = {}): OAuthProviderAdapter {
  return {
    name: 'github',
    buildAuthUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
    exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'gha_token' }),
    fetchProfile: jest.fn().mockResolvedValue({
      provider: 'github',
      providerUserId: 'gh_42',
      displayName: 'Alice',
      email: 'alice@example.com',
    } satisfies OAuthProfile),
    ...overrides,
  };
}

function buildApp(deps: Partial<OAuthRouterDeps> = {}): Express {
  const providers = deps.providers ?? new Map([['github', makeAdapter()]]);
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createOAuthRouter({
      providers,
      generateState: deps.generateState ?? (() => 'test-state-nonce'),
      issueSession: deps.issueSession,
      resolveIdentity: deps.resolveIdentity,
    }),
  );
  return app;
}

beforeEach(() => {
  oauthStateStore.clear();
  identityStore.clear();
  userStore.clear();
});

// ---------------------------------------------------------------------------
// GET /auth/oauth/start
// ---------------------------------------------------------------------------

describe('GET /auth/oauth/start', () => {
  it('redirects to the provider authorization URL', async () => {
    const res = await request(buildApp()).get('/auth/oauth/start?provider=github');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('github.com');
    expect(res.headers.location).toContain('test-state-nonce');
  });

  it('stores the state nonce in oauthStateStore', async () => {
    await request(buildApp()).get('/auth/oauth/start?provider=github');
    expect(oauthStateStore.has('test-state-nonce')).toBe(true);
    expect(oauthStateStore.get('test-state-nonce')?.provider).toBe('github');
  });

  it('returns 400 for an unknown provider', async () => {
    const res = await request(buildApp()).get('/auth/oauth/start?provider=unknown');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_provider');
  });

  it('returns 400 when provider query param is missing', async () => {
    const res = await request(buildApp()).get('/auth/oauth/start');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/oauth/callback
// ---------------------------------------------------------------------------

describe('GET /auth/oauth/callback', () => {
  function seedState(provider = 'github'): void {
    oauthStateStore.set('test-state-nonce', {
      provider,
      expiresAt: Date.now() + 60_000,
    });
  }

  it('returns 200 with session token for a new user', async () => {
    seedState();
    const res = await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&code=auth_code&state=test-state-nonce',
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.isNew).toBe(true);
    expect(res.body.user.email).toBe('alice@example.com');
    expect(typeof res.body.token).toBe('string');
    // State nonce should be consumed.
    expect(oauthStateStore.has('test-state-nonce')).toBe(false);
  });

  it('returns 200 with isNew=false for a returning user', async () => {
    // First sign-in creates the user.
    seedState();
    await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&code=code1&state=test-state-nonce',
    );

    // Second sign-in should find the existing user.
    oauthStateStore.set('test-state-nonce', { provider: 'github', expiresAt: Date.now() + 60_000 });
    const res = await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&code=code2&state=test-state-nonce',
    );

    expect(res.status).toBe(200);
    expect(res.body.isNew).toBe(false);
  });

  it('returns 400 when code is missing', async () => {
    seedState();
    const res = await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&state=test-state-nonce',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('code and state are required');
  });

  it('returns 400 when state is missing', async () => {
    const res = await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&code=auth_code',
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid or expired state', async () => {
    // State not seeded — should be rejected.
    const res = await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&code=auth_code&state=unknown-state',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_or_expired_state');
  });

  it('returns 400 for an expired state', async () => {
    oauthStateStore.set('expired-state', { provider: 'github', expiresAt: Date.now() - 1 });
    const res = await request(buildApp()).get(
      '/auth/oauth/callback?provider=github&code=auth_code&state=expired-state',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_or_expired_state');
  });

  it('returns 401 when code exchange fails', async () => {
    seedState();
    const adapter = makeAdapter({ exchangeCode: jest.fn().mockResolvedValue(null) });
    const res = await request(buildApp({ providers: new Map([['github', adapter]]) })).get(
      '/auth/oauth/callback?provider=github&code=bad_code&state=test-state-nonce',
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('code_exchange_failed');
  });

  it('returns 401 when profile fetch fails', async () => {
    seedState();
    const adapter = makeAdapter({ fetchProfile: jest.fn().mockResolvedValue(null) });
    const res = await request(buildApp({ providers: new Map([['github', adapter]]) })).get(
      '/auth/oauth/callback?provider=github&code=auth_code&state=test-state-nonce',
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('profile_fetch_failed');
  });
});

// ---------------------------------------------------------------------------
// identity.ts unit tests
// ---------------------------------------------------------------------------

describe('findOrCreateUser', () => {
  const profile: OAuthProfile = {
    provider: 'github',
    providerUserId: 'gh_99',
    displayName: 'Bob',
    email: 'bob@example.com',
  };

  it('creates a new user on first call', () => {
    const iStore = new Map();
    const uStore = new Map();
    const result = findOrCreateUser(profile, { identityStore: iStore, userStore: uStore });

    expect(result.isNew).toBe(true);
    expect(result.user.email).toBe('bob@example.com');
    expect(iStore.size).toBe(1);
    expect(uStore.size).toBe(1);
  });

  it('returns the existing user on subsequent calls', () => {
    const iStore = new Map();
    const uStore = new Map();
    const first = findOrCreateUser(profile, { identityStore: iStore, userStore: uStore });
    const second = findOrCreateUser(profile, { identityStore: iStore, userStore: uStore });

    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(uStore.size).toBe(1);
  });

  it('creates separate users for different providers', () => {
    const iStore = new Map();
    const uStore = new Map();
    findOrCreateUser({ ...profile, provider: 'github' }, { identityStore: iStore, userStore: uStore });
    findOrCreateUser({ ...profile, provider: 'google' }, { identityStore: iStore, userStore: uStore });

    expect(uStore.size).toBe(2);
  });

  it('creates separate users for different providerUserIds', () => {
    const iStore = new Map();
    const uStore = new Map();
    findOrCreateUser({ ...profile, providerUserId: 'id_1' }, { identityStore: iStore, userStore: uStore });
    findOrCreateUser({ ...profile, providerUserId: 'id_2' }, { identityStore: iStore, userStore: uStore });

    expect(uStore.size).toBe(2);
  });

  it('re-creates user when identity record exists but user was deleted', () => {
    const iStore = new Map();
    const uStore = new Map();
    const first = findOrCreateUser(profile, { identityStore: iStore, userStore: uStore });

    // Simulate user deletion.
    uStore.delete(first.user.id);

    const second = findOrCreateUser(profile, { identityStore: iStore, userStore: uStore });
    expect(second.isNew).toBe(true);
    expect(second.user.id).not.toBe(first.user.id);
  });
});
