import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import {
  createLoginRouter,
  type LoginDeps,
  type LoginVerificationResult,
} from '../routes/auth.login.js';
import { SlidingWindowLimiter } from '../middleware/rateLimit.js';

function buildDeps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    verifyCredentials: jest.fn(
      async (): Promise<LoginVerificationResult | null> => ({
        userId: 'user-1',
      }),
    ) as LoginDeps['verifyCredentials'],
    issueSession: jest.fn(async () => ({
      token: 'session-token',
      expiresAt: 9_999_999,
    })) as LoginDeps['issueSession'],
    ...overrides,
  };
}

function buildApp(deps: LoginDeps, opts?: { now?: () => number }) {
  // Fresh limiters per app so cases don't leak state into each other.
  const ipLimiter = new SlidingWindowLimiter({
    limit: 5,
    windowMs: 60_000,
    now: opts?.now,
  });
  const ipEmailLimiter = new SlidingWindowLimiter({
    limit: 3,
    windowMs: 60_000,
    now: opts?.now,
  });
  const app = express();
  app.use(express.json());
  app.use(
    createLoginRouter({
      deps,
      rateLimit: { ipLimiter, ipEmailLimiter },
    }),
  );
  return { app, ipLimiter, ipEmailLimiter };
}

describe('SlidingWindowLimiter', () => {
  it('allows up to `limit` hits and rejects the next one', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    const fourth = limiter.hit('k');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('reports a retry-after that counts down toward the oldest in-window hit', () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });

    expect(limiter.hit('k').allowed).toBe(true);

    now += 500; // still inside window
    const second = limiter.hit('k');
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBe(500);

    now += 200; // still inside window
    const third = limiter.hit('k');
    expect(third.allowed).toBe(false);
    // The oldest in-window hit is fixed at t=0 relative to start, so the
    // retry-after shrinks as real time advances — even though the caller
    // is being rate-limited the whole time.
    expect(third.retryAfterMs).toBe(300);
  });

  it('forgets hits older than the window', () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });
    expect(limiter.hit('k').allowed).toBe(true);
    now += 1500;
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('rejects nonsensical configuration', () => {
    expect(
      () => new SlidingWindowLimiter({ limit: 0, windowMs: 1 }),
    ).toThrow();
    expect(
      () => new SlidingWindowLimiter({ limit: 1, windowMs: 0 }),
    ).toThrow();
  });
});

describe('POST /auth/login validation', () => {
  it('rejects a missing or malformed email', async () => {
    const { app } = buildApp(buildDeps());
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'hunter2!secure' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejects a short password', async () => {
    const { app } = buildApp(buildDeps());
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('POST /auth/login credentials', () => {
  it('returns 401 with a generic message on wrong credentials', async () => {
    const deps = buildDeps({
      verifyCredentials: jest.fn(
        async () => null,
      ) as LoginDeps['verifyCredentials'],
    });
    const { app } = buildApp(deps);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'hunter2!secure' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid credentials' });
  });

  it('returns a session token when credentials are valid and TOTP is not required', async () => {
    const deps = buildDeps();
    const { app } = buildApp(deps);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'hunter2!secure' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: 'user-1',
      token: 'session-token',
      expiresAt: 9_999_999,
    });
    expect(deps.issueSession).toHaveBeenCalledTimes(1);
  });

  it('signals TOTP step-up without issuing a session when required', async () => {
    const deps = buildDeps({
      verifyCredentials: jest.fn(async () => ({
        userId: 'user-1',
        totpRequired: true,
      })) as LoginDeps['verifyCredentials'],
    });
    const { app } = buildApp(deps);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'hunter2!secure' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'user-1', totpRequired: true });
    expect(deps.issueSession).not.toHaveBeenCalled();
  });
});

describe('POST /auth/login rate limiting', () => {
  it('returns 429 with Retry-After once the per-email cap is exceeded', async () => {
    const deps = buildDeps({
      verifyCredentials: jest.fn(
        async () => null,
      ) as LoginDeps['verifyCredentials'],
    });
    const { app } = buildApp(deps);

    // Per-email limit is 3 (see buildApp). 4th attempt against the same
    // email from the same IP must be rejected before the route handler
    // runs.
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'hunter2!secure' });
      expect(res.status).toBe(401);
    }

    const tripped = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'hunter2!secure' });
    expect(tripped.status).toBe(429);
    expect(tripped.body).toMatchObject({ error: 'too many requests' });
    expect(tripped.headers['retry-after']).toBeDefined();
    const retryAfter = Number(tripped.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    // Verifier should not have run on the rate-limited attempt.
    expect(deps.verifyCredentials).toHaveBeenCalledTimes(3);
  });

  it('returns 429 with Retry-After once the per-IP cap is exceeded across emails', async () => {
    const deps = buildDeps({
      verifyCredentials: jest.fn(
        async () => null,
      ) as LoginDeps['verifyCredentials'],
    });
    const { app } = buildApp(deps);

    // Per-IP limit is 5. Rotate the email each time so the per-(IP,email)
    // bucket never trips first — only the per-IP bucket should fire.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: `u${i}@example.com`, password: 'hunter2!secure' });
      expect(res.status).toBe(401);
    }

    const tripped = await request(app)
      .post('/auth/login')
      .send({ email: 'u-final@example.com', password: 'hunter2!secure' });
    expect(tripped.status).toBe(429);
    expect(tripped.headers['retry-after']).toBeDefined();
  });
});
