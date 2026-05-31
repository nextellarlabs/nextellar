/**
 * Middleware test suite.
 *
 * Covers every middleware in routes-d/middleware/ using lightweight
 * in-process harnesses — no full server boot, no network I/O.
 *
 * Middleware under test
 * ---------------------
 *   - rateLimit   (SlidingWindowLimiter + loginRateLimit Express middleware)
 *   - jwt         (requireJwt)
 *   - rbac        (requireRole)
 *   - stepUpAuth  (requireStepUp)
 *   - idempotency (idempotency)
 *   - sanitizer   (sanitize)
 *
 * Each describe block exercises:
 *   - pass-through (allowed request reaches next())
 *   - rejection    (forbidden / invalid request gets the right error status)
 *   - error paths  (malformed input, missing headers, edge cases)
 *
 * Each test is independent: shared state (rate limiters, token stores) is
 * reset in beforeEach hooks.
 */

import request from 'supertest';
import express, { type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import {
  SlidingWindowLimiter,
  loginRateLimit,
} from '../middleware/rateLimit.js';
import { requireJwt } from '../middleware/jwt.js';
import { requireRole } from '../middleware/rbac.js';
import { requireStepUp } from '../middleware/stepUpAuth.js';
import { idempotency, IdempotencyStore } from '../middleware/idempotency.js';
import { sanitize } from '../middleware/sanitizer.js';
import { tokenVersionStore } from '../auth/tokenVersion.js';
import { Roles } from '../auth/roles.js';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'nextellar-routes-d-jwt-secret';
const JWT_ISSUER = 'nextellar';
const JWT_AUDIENCE = 'nextellar-app';

function signToken(
  payload: object,
  opts: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
    ...opts,
  });
}

function buildApp(...middlewares: RequestHandler[]) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  for (const mw of middlewares) app.use(mw);
  app.get('/ok', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/ok', (_req, res) => res.status(200).json({ ok: true }));
  app.patch('/ok', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// 1. Rate limit — SlidingWindowLimiter unit tests
// ---------------------------------------------------------------------------

describe('SlidingWindowLimiter (unit)', () => {
  it('allows up to the limit within the window', () => {
    let now = 0;
    const lim = new SlidingWindowLimiter({ limit: 3, windowMs: 1000, now: () => now });
    expect(lim.hit('key').allowed).toBe(true);  // 1
    expect(lim.hit('key').allowed).toBe(true);  // 2
    expect(lim.hit('key').allowed).toBe(true);  // 3
    expect(lim.hit('key').allowed).toBe(false); // 4 — over limit
  });

  it('resets the window after windowMs elapses', () => {
    let now = 0;
    const lim = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => now });
    lim.hit('key'); lim.hit('key'); lim.hit('key'); // over limit
    now = 1001; // advance past the window
    expect(lim.hit('key').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const lim = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
    lim.hit('a'); // over for 'a'
    expect(lim.hit('b').allowed).toBe(true);  // 'b' unaffected
    expect(lim.hit('a').allowed).toBe(false); // 'a' still blocked
  });

  it('returns remaining=0 once the limit is exceeded', () => {
    const lim = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
    lim.hit('k');
    const result = lim.hit('k');
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('reset() clears all buckets', () => {
    const lim = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
    lim.hit('k'); lim.hit('k'); // over
    lim.reset();
    expect(lim.hit('k').allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Rate limit — loginRateLimit Express middleware
// ---------------------------------------------------------------------------

describe('loginRateLimit middleware', () => {
  function buildLoginApp(limit: number) {
    const ipLimiter = new SlidingWindowLimiter({ limit, windowMs: 60_000 });
    const ipEmailLimiter = new SlidingWindowLimiter({ limit, windowMs: 60_000 });
    const app = express();
    app.use(express.json());
    app.post('/auth/login', loginRateLimit({ ipLimiter, ipEmailLimiter }), (_req, res) =>
      res.status(200).json({ ok: true }),
    );
    return app;
  }

  it('passes through requests under the limit', async () => {
    const res = await request(buildLoginApp(10))
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'pass1234' });
    expect(res.status).toBe(200);
  });

  it('returns 429 with Retry-After header once the limit is exceeded', async () => {
    const app = buildLoginApp(1);
    await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body).toEqual(expect.objectContaining({ error: 'too many requests' }));
  });

  it('does not rate-limit GET requests', async () => {
    const ipLimiter = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
    const ipEmailLimiter = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
    const app = express();
    app.use(express.json());
    app.get('/auth/login', loginRateLimit({ ipLimiter, ipEmailLimiter }), (_req, res) =>
      res.json({ ok: true }),
    );
    // Hit it many times — should never 429 because it's GET
    for (let i = 0; i < 5; i++) {
      const r = await request(app).get('/auth/login');
      expect(r.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. JWT middleware
// ---------------------------------------------------------------------------

describe('requireJwt middleware', () => {
  beforeEach(() => tokenVersionStore.reset());

  const buildApp_ = (scopes?: string[]) => buildApp(requireJwt({ scopes }));

  it('passes through a valid token with correct claims', async () => {
    const token = signToken({ sub: 'user-1', scopes: ['read'] });
    const res = await request(buildApp_())
      .get('/ok')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 when Authorization header is absent', async () => {
    const res = await request(buildApp_()).get('/ok');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 for an expired token', async () => {
    const token = signToken({ sub: 'u' }, { expiresIn: '-1s' });
    const res = await request(buildApp_()).get('/ok').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered token', async () => {
    const token = signToken({ sub: 'u' }) + 'x';
    const res = await request(buildApp_()).get('/ok').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a stale token version', async () => {
    tokenVersionStore.bump('user-2');
    const token = signToken({ sub: 'user-2', tv: 0 }); // tv=0 is stale after bump
    const res = await request(buildApp_()).get('/ok').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when required scope is missing', async () => {
    const token = signToken({ sub: 'u', scopes: ['read'] });
    const res = await request(buildApp_(['write']))
      .get('/ok')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('passes through when all required scopes are present', async () => {
    const token = signToken({ sub: 'u', scopes: ['read', 'write'] });
    const res = await request(buildApp_(['read', 'write']))
      .get('/ok')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. RBAC middleware
// ---------------------------------------------------------------------------

describe('requireRole middleware', () => {
  function userRequest(role: string) {
    return request(buildApp(
      (req, _res, next) => { (req as any).user = { role }; next(); },
      requireRole(Roles.Admin),
    )).get('/ok');
  }

  it('passes through when the role matches', async () => {
    const res = await userRequest(Roles.Admin);
    expect(res.status).toBe(200);
  });

  it('returns 403 when the role is insufficient', async () => {
    const res = await userRequest(Roles.User);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'insufficient role' });
  });

  it('returns 401 when no user/role is attached', async () => {
    const res = await request(buildApp(requireRole(Roles.Admin))).get('/ok');
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not a known Role value', async () => {
    const res = await userRequest('superuser');
    expect(res.status).toBe(403);
  });

  it('accepts multiple allowed roles', async () => {
    const app = buildApp(
      (req, _res, next) => { (req as any).user = { role: Roles.Moderator }; next(); },
      requireRole(Roles.Admin, Roles.Moderator),
    );
    const res = await request(app).get('/ok');
    expect(res.status).toBe(200);
  });

  it('throws at construction time when allowedRoles is empty', () => {
    expect(() => requireRole()).toThrow('empty allow-list');
  });
});

// ---------------------------------------------------------------------------
// 5. Step-up auth middleware
// ---------------------------------------------------------------------------

describe('requireStepUp middleware', () => {
  const app = buildApp(requireStepUp);

  it('passes through when x-step-up-verified: true is set', async () => {
    const res = await request(app).get('/ok').set('x-step-up-verified', 'true');
    expect(res.status).toBe(200);
  });

  it('returns 403 when the header is absent', async () => {
    const res = await request(app).get('/ok');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('step_up_required');
  });

  it('returns 403 when the header is "false"', async () => {
    const res = await request(app).get('/ok').set('x-step-up-verified', 'false');
    expect(res.status).toBe(403);
  });

  it('is case-insensitive for the header value', async () => {
    const res = await request(app).get('/ok').set('x-step-up-verified', 'TRUE');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency middleware
// ---------------------------------------------------------------------------

describe('idempotency middleware', () => {
  let store: IdempotencyStore;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    store = new IdempotencyStore();
    app = express();
    app.use(express.json());
    app.post('/ok', idempotency({ store }), (_req, res) =>
      res.status(201).json({ created: true }),
    );
  });

  it('passes through on first request and returns 201', async () => {
    const res = await request(app)
      .post('/ok')
      .set('Idempotency-Key', 'key-001')
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: true });
  });

  it('replays the stored response on a duplicate request', async () => {
    await request(app).post('/ok').set('Idempotency-Key', 'key-002').send({});
    const replay = await request(app).post('/ok').set('Idempotency-Key', 'key-002').send({});
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ created: true });
  });

  it('passes through GET requests without checking the key', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.get('/ok', idempotency({ store }), (_req, res) => res.json({ ok: true }));
    const res = await request(app2).get('/ok').set('Idempotency-Key', 'any');
    expect(res.status).toBe(200);
  });

  it('returns 400 for an invalid idempotency key', async () => {
    const res = await request(app)
      .post('/ok')
      .set('Idempotency-Key', 'a'.repeat(200)) // exceeds max length
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_idempotency_key');
  });

  it('passes through when no key is supplied (key is optional)', async () => {
    const res = await request(app).post('/ok').send({});
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 7. Sanitizer middleware
// ---------------------------------------------------------------------------

describe('sanitize middleware', () => {
  function buildSanitizerApp(opts = {}) {
    const app = express();
    app.use(express.json());
    app.use(sanitize(opts));
    app.post('/ok', (req, res) => res.json({ body: req.body }));
    app.get('/ok', (req, res) => res.json({ query: req.query }));
    return app;
  }

  it('strips NUL bytes from string body fields', async () => {
    const res = await request(buildSanitizerApp())
      .post('/ok')
      .send({ name: 'evil\0name' });
    expect(res.status).toBe(200);
    expect(res.body.body.name).toBe('evilname');
  });

  it('strips NUL bytes from nested objects', async () => {
    const res = await request(buildSanitizerApp())
      .post('/ok')
      .send({ nested: { field: 'a\0b' } });
    expect(res.body.body.nested.field).toBe('ab');
  });

  it('strips NUL bytes from query params', async () => {
    const res = await request(buildSanitizerApp())
      .get('/ok')
      .query({ q: 'hello\x00world' });
    expect(res.body.query.q).toBe('helloworld');
  });

  it('trims whitespace when trim option is true', async () => {
    const res = await request(buildSanitizerApp({ trim: true }))
      .post('/ok')
      .send({ name: '  padded  ' });
    expect(res.body.body.name).toBe('padded');
  });

  it('does not trim whitespace by default', async () => {
    const res = await request(buildSanitizerApp())
      .post('/ok')
      .send({ name: '  padded  ' });
    expect(res.body.body.name).toBe('  padded  ');
  });

  it('returns 400 for a non-object JSON body', async () => {
    const app = buildSanitizerApp();
    // Manually set the parsed body to a scalar to simulate the edge case
    const overrideApp = express();
    overrideApp.use(express.json());
    overrideApp.use((req, _res, next) => {
      // Replace body with a scalar after express.json() parsed it
      (req as any).body = 'a string body';
      next();
    });
    overrideApp.use(sanitize());
    overrideApp.post('/ok', (_req, res) => res.json({ ok: true }));

    const res = await request(overrideApp).post('/ok').send('"a string body"');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request_body');
  });

  it('passes through undefined body without error', async () => {
    const app = express();
    app.use(sanitize());
    app.get('/ok', (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/ok');
    expect(res.status).toBe(200);
  });
});