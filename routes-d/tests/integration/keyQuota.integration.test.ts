/**
 * Integration tests for keyQuota middleware + quota admin routes.
 *
 * Wires a real Express application with:
 *   - keyQuota middleware protecting /api/* routes
 *   - /admin/quota admin routes for state inspection and management
 *   - A simple /api/data echo endpoint under the quota
 *
 * Scenarios covered:
 *   - Under-quota requests proceed (200) with correct headers
 *   - Quota exhaust returns 429 with Retry-After
 *   - Admin reset endpoint (POST /admin/quota/:key/reset) unblocks the key
 *   - Admin list endpoint (GET /admin/quota) reflects current state
 *   - Admin policy update (PUT /admin/quota/:key/policy) takes effect
 *   - Admin delete (DELETE /admin/quota/:key) wipes state
 *   - allowAnonymous option lets keyless requests pass
 *   - Concurrent requests (sequential Promises) are handled correctly
 *   - Multiple independent keys do not interfere with each other
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { keyQuota } from '../../middleware/keyQuota.js';
import quotaRouter from '../../routes/quota.js';
import { __resetStore } from '../../lib/quotaStore.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY_A  = 'integration-key-aaaa';
const KEY_B  = 'integration-key-bbbb';
const OP_ID  = 'operator-001';

function buildApp(quotaOpts?: Parameters<typeof keyQuota>[0]) {
  const app = express();
  app.use(express.json());

  // Protected API routes
  const apiRouter = express.Router();
  apiRouter.use(keyQuota(quotaOpts));
  apiRouter.get('/data', (_req: Request, res: Response) => {
    res.status(200).json({ data: 'ok' });
  });
  app.use('/api', apiRouter);

  // Admin quota management routes (unprotected for test simplicity)
  app.use(quotaRouter);

  // Generic error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('keyQuota — integration', () => {
  beforeEach(() => {
    __resetStore();
  });

  // ── Under-quota flow ───────────────────────────────────────────────────────

  describe('under-quota requests', () => {
    it('allows a request and returns 200 with rate-limit headers', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });

      const res = await request(app)
        .get('/api/data')
        .set('X-API-Key', KEY_A);

      expect(res.status).toBe(200);
      expect(res.body.data).toBe('ok');
      expect(res.headers['x-ratelimit-limit']).toBe('10');
      expect(res.headers['x-ratelimit-remaining']).toBe('9');
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('decrements remaining across requests', async () => {
      const app = buildApp({ defaultPolicy: { limit: 5, windowMs: 60_000 } });

      for (let i = 5; i >= 1; i--) {
        const res = await request(app)
          .get('/api/data')
          .set('X-API-Key', KEY_A);
        expect(res.headers['x-ratelimit-remaining']).toBe(String(i - 1));
      }
    });
  });

  // ── Quota exhaustion → 429 ─────────────────────────────────────────────────

  describe('quota exhaustion', () => {
    it('returns 429 after the policy limit is reached', async () => {
      const app = buildApp({ defaultPolicy: { limit: 2, windowMs: 60_000 } });

      await request(app).get('/api/data').set('X-API-Key', KEY_A);
      await request(app).get('/api/data').set('X-API-Key', KEY_A);

      const res = await request(app).get('/api/data').set('X-API-Key', KEY_A);

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
      expect(res.headers['retry-after']).toBeDefined();
      expect(parseInt(res.headers['retry-after'], 10)).toBeGreaterThan(0);
    });

    it('exhaustion of KEY_A does not affect KEY_B', async () => {
      const app = buildApp({ defaultPolicy: { limit: 1, windowMs: 60_000 } });

      await request(app).get('/api/data').set('X-API-Key', KEY_A); // uses up KEY_A

      const resA = await request(app).get('/api/data').set('X-API-Key', KEY_A);
      const resB = await request(app).get('/api/data').set('X-API-Key', KEY_B);

      expect(resA.status).toBe(429);
      expect(resB.status).toBe(200);
    });
  });

  // ── Admin reset unblocks an exhausted key ─────────────────────────────────

  describe('admin reset flow', () => {
    it('POST /admin/quota/:key/reset unblocks an exhausted key', async () => {
      const app = buildApp({ defaultPolicy: { limit: 1, windowMs: 60_000 } });

      await request(app).get('/api/data').set('X-API-Key', KEY_A);

      // Confirm exhausted
      const before = await request(app).get('/api/data').set('X-API-Key', KEY_A);
      expect(before.status).toBe(429);

      // Admin reset
      const resetRes = await request(app)
        .post(`/admin/quota/${KEY_A}/reset`)
        .set('x-operator-id', OP_ID);

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // Key should work again
      const after = await request(app).get('/api/data').set('X-API-Key', KEY_A);
      expect(after.status).toBe(200);
    });

    it('POST /admin/quota/:key/reset returns 401 without operator id', async () => {
      const app = buildApp();

      const res = await request(app).post(`/admin/quota/${KEY_A}/reset`);
      expect(res.status).toBe(401);
    });
  });

  // ── Admin list endpoint ────────────────────────────────────────────────────

  describe('GET /admin/quota', () => {
    it('returns an empty list before any key is used', async () => {
      const app = buildApp();
      const res = await request(app).get('/admin/quota');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('lists all keys that have made requests', async () => {
      const app = buildApp({ defaultPolicy: { limit: 10, windowMs: 60_000 } });

      await request(app).get('/api/data').set('X-API-Key', KEY_A);
      await request(app).get('/api/data').set('X-API-Key', KEY_B);

      const res = await request(app).get('/admin/quota');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const keys = res.body.data.map((b: { key: string }) => b.key);
      expect(keys).toContain(KEY_A);
      expect(keys).toContain(KEY_B);
    });
  });

  // ── Admin single key endpoint ──────────────────────────────────────────────

  describe('GET /admin/quota/:key', () => {
    it('returns bucket details for a used key', async () => {
      const app = buildApp({ defaultPolicy: { limit: 5, windowMs: 60_000 } });

      await request(app).get('/api/data').set('X-API-Key', KEY_A);

      const res = await request(app).get(`/admin/quota/${KEY_A}`);

      expect(res.status).toBe(200);
      expect(res.body.data.key).toBe(KEY_A);
      expect(res.body.data.limit).toBe(5);
      expect(res.body.data.remaining).toBe(4);
      expect(res.body.data.resetAt).toBeDefined();
    });
  });

  // ── Admin policy update ────────────────────────────────────────────────────

  describe('PUT /admin/quota/:key/policy', () => {
    it('updates the policy and subsequent requests reflect it', async () => {
      const app = buildApp({ defaultPolicy: { limit: 100, windowMs: 60_000 } });

      // Update policy
      const updateRes = await request(app)
        .put(`/admin/quota/${KEY_A}/policy`)
        .set('x-operator-id', OP_ID)
        .send({ limit: 3, windowMs: 30_000 });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.policy.limit).toBe(3);

      // Reset so new policy takes effect from a clean window
      await request(app)
        .post(`/admin/quota/${KEY_A}/reset`)
        .set('x-operator-id', OP_ID);

      const res = await request(app).get('/api/data').set('X-API-Key', KEY_A);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    });

    it('returns 400 for invalid policy values', async () => {
      const app = buildApp();

      const res = await request(app)
        .put(`/admin/quota/${KEY_A}/policy`)
        .set('x-operator-id', OP_ID)
        .send({ limit: -5, windowMs: 1000 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_POLICY');
    });

    it('returns 401 without operator id', async () => {
      const app = buildApp();

      const res = await request(app)
        .put(`/admin/quota/${KEY_A}/policy`)
        .send({ limit: 10, windowMs: 60_000 });

      expect(res.status).toBe(401);
    });
  });

  // ── Admin delete ───────────────────────────────────────────────────────────

  describe('DELETE /admin/quota/:key', () => {
    it('removes the key and subsequent request starts a fresh window', async () => {
      const app = buildApp({ defaultPolicy: { limit: 2, windowMs: 60_000 } });

      await request(app).get('/api/data').set('X-API-Key', KEY_A);
      await request(app).get('/api/data').set('X-API-Key', KEY_A);

      // Confirm exhausted
      const before = await request(app).get('/api/data').set('X-API-Key', KEY_A);
      expect(before.status).toBe(429);

      // Delete state
      const delRes = await request(app)
        .delete(`/admin/quota/${KEY_A}`)
        .set('x-operator-id', OP_ID);

      expect(delRes.status).toBe(200);

      // Key_A is no longer in the list
      const listRes = await request(app).get('/admin/quota');
      const keys = listRes.body.data.map((b: { key: string }) => b.key);
      expect(keys).not.toContain(KEY_A);

      // And it gets a fresh window on the next request
      const after = await request(app).get('/api/data').set('X-API-Key', KEY_A);
      expect(after.status).toBe(200);
      expect(after.headers['x-ratelimit-remaining']).toBe('1');
    });

    it('returns 401 without operator id', async () => {
      const app = buildApp();
      const res = await request(app).delete(`/admin/quota/${KEY_A}`);
      expect(res.status).toBe(401);
    });
  });

  // ── allowAnonymous option ──────────────────────────────────────────────────

  describe('allowAnonymous', () => {
    it('passes through requests without a key when enabled', async () => {
      const app = buildApp({ allowAnonymous: true });
      const res = await request(app).get('/api/data');

      expect(res.status).toBe(200);
    });

    it('enforces quota for keyed requests even with allowAnonymous', async () => {
      const app = buildApp({
        allowAnonymous: true,
        defaultPolicy: { limit: 1, windowMs: 60_000 },
      });

      await request(app).get('/api/data').set('X-API-Key', KEY_A);
      const res = await request(app).get('/api/data').set('X-API-Key', KEY_A);

      expect(res.status).toBe(429);
    });
  });

  // ── Concurrent requests ────────────────────────────────────────────────────

  describe('concurrent requests', () => {
    it('counts all concurrent calls correctly — no double-spend', async () => {
      const LIMIT = 5;
      const TOTAL = 8; // more than the limit
      const app = buildApp({ defaultPolicy: { limit: LIMIT, windowMs: 60_000 } });

      const responses = await Promise.all(
        Array.from({ length: TOTAL }, () =>
          request(app).get('/api/data').set('X-API-Key', KEY_A),
        ),
      );

      const allowed = responses.filter((r) => r.status === 200).length;
      const denied  = responses.filter((r) => r.status === 429).length;

      expect(allowed).toBe(LIMIT);
      expect(denied).toBe(TOTAL - LIMIT);
    });

    it('two keys running concurrently remain independent', async () => {
      const LIMIT = 3;
      const app = buildApp({ defaultPolicy: { limit: LIMIT, windowMs: 60_000 } });

      const [resA1, resB1, resA2, resB2, resA3, resB3, resA4, resB4] =
        await Promise.all([
          request(app).get('/api/data').set('X-API-Key', KEY_A),
          request(app).get('/api/data').set('X-API-Key', KEY_B),
          request(app).get('/api/data').set('X-API-Key', KEY_A),
          request(app).get('/api/data').set('X-API-Key', KEY_B),
          request(app).get('/api/data').set('X-API-Key', KEY_A),
          request(app).get('/api/data').set('X-API-Key', KEY_B),
          request(app).get('/api/data').set('X-API-Key', KEY_A), // 4th → denied
          request(app).get('/api/data').set('X-API-Key', KEY_B), // 4th → denied
        ]);

      const aResults = [resA1, resA2, resA3, resA4];
      const bResults = [resB1, resB2, resB3, resB4];

      expect(aResults.filter((r) => r.status === 200).length).toBe(LIMIT);
      expect(bResults.filter((r) => r.status === 200).length).toBe(LIMIT);
      expect(resA4.status).toBe(429);
      expect(resB4.status).toBe(429);
    });
  });
});
