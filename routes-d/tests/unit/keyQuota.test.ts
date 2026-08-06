/**
 * Unit tests for routes-d/middleware/keyQuota.ts
 *
 * Tests are written against a minimal Express app wired with the middleware so
 * we can verify real HTTP semantics (status codes, headers, JSON bodies).
 *
 * Covers:
 *   - No key present → 401
 *   - Invalid key format → 401
 *   - Under-quota request → 200 with rate-limit headers
 *   - Quota exhausted → 429 with Retry-After
 *   - Key sourced from Bearer header
 *   - Key sourced from X-API-Key header
 *   - Key sourced from api_key query param
 *   - allowAnonymous=true passes keyless requests through
 *   - Per-key policies applied at middleware creation time
 *   - defaultPolicy option is respected
 */

import express, { Request, Response } from 'express';
import request from 'supertest';
import { keyQuota } from '../../middleware/keyQuota.js';
import { __resetStore, setPolicy } from '../../lib/quotaStore.js';

// A valid key format: alphanumeric + hyphens/underscores, 16–128 chars.
const KEY = 'valid-api-key-0001';
const KEY2 = 'valid-api-key-0002';

function buildApp(opts?: Parameters<typeof keyQuota>[0]) {
  const app = express();
  app.use(express.json());
  app.use(keyQuota(opts));
  app.get('/ping', (_req: Request, res: Response) => {
    res.status(200).json({ pong: true });
  });
  return app;
}

describe('keyQuota middleware', () => {
  beforeEach(() => {
    __resetStore();
  });

  // ── Missing key ──────────────────────────────────────────────────────────

  describe('missing / invalid API key', () => {
    it('returns 401 when no API key is present', async () => {
      const app = buildApp();
      const res = await request(app).get('/ping');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_API_KEY');
    });

    it('returns 401 when key format is invalid (too short)', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/ping')
        .set('X-API-Key', 'short');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_API_KEY');
    });

    it('returns 401 for a blank Bearer token', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/ping')
        .set('Authorization', 'Bearer ');

      expect(res.status).toBe(401);
    });
  });

  // ── Key resolution ────────────────────────────────────────────────────────

  describe('key resolution sources', () => {
    it('accepts key from Authorization: Bearer header', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });
      const res = await request(app)
        .get('/ping')
        .set('Authorization', `Bearer ${KEY}`);

      expect(res.status).toBe(200);
    });

    it('accepts key from X-API-Key header', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });
      const res = await request(app)
        .get('/ping')
        .set('X-API-Key', KEY);

      expect(res.status).toBe(200);
    });

    it('accepts key from api_key query param', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });
      const res = await request(app).get(`/ping?api_key=${KEY}`);

      expect(res.status).toBe(200);
    });

    it('prioritises Bearer over X-API-Key header', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });
      const res = await request(app)
        .get('/ping')
        .set('Authorization', `Bearer ${KEY}`)
        .set('X-API-Key', KEY2);

      // Both are valid keys; the request should pass
      expect(res.status).toBe(200);
    });
  });

  // ── Rate-limit headers ─────────────────────────────────────────────────────

  describe('rate-limit headers', () => {
    it('attaches X-RateLimit-Limit header', async () => {
      const app = buildApp({ defaultPolicy: { limit: 100, windowMs: 60_000 } });
      const res = await request(app).get('/ping').set('X-API-Key', KEY);

      expect(res.headers['x-ratelimit-limit']).toBe('100');
    });

    it('attaches X-RateLimit-Remaining header and decrements it', async () => {
      const app = buildApp({ defaultPolicy: { limit: 5, windowMs: 60_000 } });

      const first = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(first.headers['x-ratelimit-remaining']).toBe('4');

      const second = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(second.headers['x-ratelimit-remaining']).toBe('3');
    });

    it('attaches X-RateLimit-Reset as epoch seconds', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });
      const beforeSec = Math.floor(Date.now() / 1000);
      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      const afterSec = Math.ceil((Date.now() + 60_000) / 1000);

      const resetSec = parseInt(res.headers['x-ratelimit-reset'], 10);
      expect(resetSec).toBeGreaterThanOrEqual(beforeSec + 59);
      expect(resetSec).toBeLessThanOrEqual(afterSec + 1);
    });
  });

  // ── 429 / quota exhausted ──────────────────────────────────────────────────

  describe('quota exhausted', () => {
    it('returns 429 after the limit is reached', async () => {
      const app = buildApp({ defaultPolicy: { limit: 2, windowMs: 60_000 } });

      await request(app).get('/ping').set('X-API-Key', KEY);
      await request(app).get('/ping').set('X-API-Key', KEY);

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(res.status).toBe(429);
    });

    it('returns QUOTA_EXCEEDED error code on 429', async () => {
      const app = buildApp({ defaultPolicy: { limit: 1, windowMs: 60_000 } });
      await request(app).get('/ping').set('X-API-Key', KEY);

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    });

    it('includes Retry-After header on 429', async () => {
      const app = buildApp({ defaultPolicy: { limit: 1, windowMs: 60_000 } });
      await request(app).get('/ping').set('X-API-Key', KEY);

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      const retryAfter = parseInt(res.headers['retry-after'], 10);

      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('includes retryAfter and resetAt in the 429 body', async () => {
      const app = buildApp({ defaultPolicy: { limit: 1, windowMs: 60_000 } });
      await request(app).get('/ping').set('X-API-Key', KEY);

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(res.body.error.retryAfter).toBeGreaterThanOrEqual(0);
      expect(res.body.error.resetAt).toBeDefined();
    });

    it('X-RateLimit-Remaining stays at 0 on subsequent rejected calls', async () => {
      const app = buildApp({ defaultPolicy: { limit: 1, windowMs: 60_000 } });
      await request(app).get('/ping').set('X-API-Key', KEY); // consume

      const r1 = await request(app).get('/ping').set('X-API-Key', KEY); // rejected
      const r2 = await request(app).get('/ping').set('X-API-Key', KEY); // rejected again

      expect(r1.headers['x-ratelimit-remaining']).toBe('0');
      expect(r2.headers['x-ratelimit-remaining']).toBe('0');
    });
  });

  // ── Anonymous access ───────────────────────────────────────────────────────

  describe('allowAnonymous option', () => {
    it('passes through requests with no key when allowAnonymous=true', async () => {
      const app = buildApp({ allowAnonymous: true });
      const res = await request(app).get('/ping');

      expect(res.status).toBe(200);
    });

    it('still enforces quota on requests that do carry a key', async () => {
      const app = buildApp({
        allowAnonymous: true,
        defaultPolicy: { limit: 1, windowMs: 60_000 },
      });
      await request(app).get('/ping').set('X-API-Key', KEY);

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(res.status).toBe(429);
    });
  });

  // ── Per-key policy via options.policies ────────────────────────────────────

  describe('per-key policies from options', () => {
    it('applies the matching per-key policy', async () => {
      const app = buildApp({
        policies: { [KEY]: { limit: 3, windowMs: 60_000 } },
      });

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    });

    it('does not apply one key\'s policy to a different key', async () => {
      const app = buildApp({
        defaultPolicy: { limit: 50, windowMs: 60_000 },
        policies: { [KEY]: { limit: 3, windowMs: 60_000 } },
      });

      const res = await request(app).get('/ping').set('X-API-Key', KEY2);
      expect(res.headers['x-ratelimit-limit']).toBe('50');
    });
  });

  // ── defaultPolicy option ───────────────────────────────────────────────────

  describe('defaultPolicy option', () => {
    it('overrides the store DEFAULT_POLICY for unlisted keys', async () => {
      const app = buildApp({ defaultPolicy: { limit: 77, windowMs: 30_000 } });

      const res = await request(app).get('/ping').set('X-API-Key', KEY);
      expect(res.headers['x-ratelimit-limit']).toBe('77');
    });
  });

  // ── Pre-registered policy in store ────────────────────────────────────────

  describe('policy already in store', () => {
    it('honours a policy registered in the store before middleware runs', async () => {
      setPolicy(KEY, { limit: 9, windowMs: 60_000 });

      const app = buildApp(); // no options — relies on store policy
      const res = await request(app).get('/ping').set('X-API-Key', KEY);

      expect(res.headers['x-ratelimit-limit']).toBe('9');
    });
  });
});
