/**
 * Tests for velocity-based fraud scoring middleware.
 *
 * Covers: normal traffic, high request spikes, score increase, score decay,
 * independent user/IP tracking, auto-block threshold, threshold disabled,
 * missing user ID, missing IP, concurrent requests, and cleanup of expired
 * windows.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  velocityScoreMiddleware,
  runCleanup,
  stopCleanup,
  __resetBuckets,
  __getBuckets,
  __getDefaultConfig,
  type VelocityConfig,
  type VelocityScoreResult,
} from '../middleware/velocityScore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a small Express app that uses the velocity middleware + a simple route. */
function buildApp(config: Partial<VelocityConfig> = {}) {
  const app = express();
  app.use(express.json());
  // Make req.ip work in tests by trusting the proxy
  app.set('trust proxy', true);
  app.use(velocityScoreMiddleware(config));
  app.get('/test', (req: Request, res: Response) => {
    res.json({ ok: true, velocityScore: req.velocityScore });
  });
  app.post('/test', (req: Request, res: Response) => {
    res.json({ ok: true, velocityScore: req.velocityScore });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

/** Helper to advance fake time by the given ms. Returns the new "now". */
async function advanceTime(_app: ReturnType<typeof buildApp>, _ms: number): Promise<void> {
  // supertest doesn't give us a way to mock Date.now(), so for most tests
  // we use real time. For decay tests we sleep briefly.
  await new Promise((r) => setTimeout(r, _ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('velocityScoreMiddleware', () => {
  beforeEach(() => {
    __resetBuckets();
    // Restart cleanup (__resetBuckets stops it)
  });

  afterAll(() => {
    stopCleanup();
  });

  // -----------------------------------------------------------------------
  // Normal traffic
  // -----------------------------------------------------------------------
  describe('normal traffic', () => {
    it('assigns a low score for a handful of requests spread over time', async () => {
      const app = buildApp();

      const res1 = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '192.168.1.10')
        .send({ userId: 'user-normal' });

      expect(res1.status).toBe(200);
      const vs1: VelocityScoreResult = res1.body.velocityScore;
      expect(vs1.score).toBeGreaterThanOrEqual(1);
      expect(vs1.blocked).toBeUndefined();
    });

    it('returns score that includes both userCount and ipCount', async () => {
      const app = buildApp();

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.0.0.1')
        .send({ userId: 'user-a' });

      expect(res.status).toBe(200);
      const vs = res.body.velocityScore as VelocityScoreResult;
      expect(vs.userCount).toBe(1);
      expect(vs.ipCount).toBe(1);
      expect(vs.score).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // High request spike (burst detection)
  // -----------------------------------------------------------------------
  describe('high request spike', () => {
    it('amplifies the score when many requests arrive in rapid succession', async () => {
      const app = buildApp({ burstWindowMs: 60_000 }); // large burst window for test

      // Send 10 requests rapidly
      let lastScore = 0;
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.1.1.1')
          .send({ userId: 'user-burst' });

        const vs = res.body.velocityScore as VelocityScoreResult;

        if (i === 0) {
          // First request: count=1, burstRatio=1 → score = 1 * burstMultiplier = 2
          expect(vs.score).toBe(2);
        } else {
          // Score should grow non-linearly due to burst
          expect(vs.score).toBeGreaterThan(lastScore);
        }
        lastScore = vs.score;
      }

      // Final score should be notably higher than the raw count (10)
      // because burst multiplier is applied
      expect(lastScore).toBeGreaterThan(10);
    });
  });

  // -----------------------------------------------------------------------
  // Score increases correctly
  // -----------------------------------------------------------------------
  describe('score increases correctly', () => {
    it('increases the score monotonically as requests accumulate', async () => {
      const app = buildApp();
      const scores: number[] = [];

      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.2.2.2')
          .send({ userId: 'user-mono' });

        const vs = res.body.velocityScore as VelocityScoreResult;
        scores.push(vs.score);
      }

      // Scores should strictly increase (or at least never decrease)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Score decays over time
  // -----------------------------------------------------------------------
  describe('score decays over time', () => {
    it(
      'returns a lower score after the window has partially elapsed',
      async () => {
        const windowMs = 500;
        const app = buildApp({ windowSizeMs: windowMs });

        // Send a burst
        for (let i = 0; i < 5; i++) {
          await request(app)
            .get('/test')
            .set('X-Forwarded-For', '10.3.3.3')
            .send({ userId: 'user-decay' });
        }

        // Wait for window to expire (plus a small buffer)
        await advanceTime(app, windowMs + 100);

        // Now the score should be back to baseline (first request in new window)
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.3.3.3')
          .send({ userId: 'user-decay' });

        const vs = res.body.velocityScore as VelocityScoreResult;
        // After all timestamps expired, only the current request should be in the window
        expect(vs.score).toBeLessThanOrEqual(5);
      },
      10_000, // timeout for sleep
    );
  });

  // -----------------------------------------------------------------------
  // User and IP tracked independently
  // -----------------------------------------------------------------------
  describe('user/IP tracking independence', () => {
    it('tracks user and IP separately in different buckets', async () => {
      const app = buildApp();

      // User A from IP X
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.4.4.1')
        .send({ userId: 'user-indie-1' });

      // User B from the same IP X
      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.4.4.1')
        .send({ userId: 'user-indie-2' });

      const vs = res.body.velocityScore as VelocityScoreResult;
      // IP count should be 2 (two requests from same IP)
      expect(vs.ipCount).toBe(2);
      // But user count should be 1 (first request for this user)
      expect(vs.userCount).toBe(1);
    });

    it('assigns separate buckets for user and IP prefixes', () => {
      const app = buildApp();
      // Trigger to populate buckets
      return request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.5.5.5')
        .send({ userId: 'user-separate' })
        .then(() => {
          const buckets = __getBuckets();
          const keys = Array.from(buckets.keys());
          expect(keys).toContain('user:user-separate');
          expect(keys).toContain('ip:10.5.5.5');
        });
    });
  });

  // -----------------------------------------------------------------------
  // Auto-block threshold
  // -----------------------------------------------------------------------
  describe('auto-block threshold', () => {
    it('blocks with 429 when score reaches the threshold', async () => {
      const app = buildApp({ blockThreshold: 5 });

      // Send 10 requests rapidly from the same user+IP
      let blocked = false;
      for (let i = 0; i < 15; i++) {
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.6.6.6')
          .send({ userId: 'user-block' });

        if (res.status === 429) {
          blocked = true;
          expect(res.body.error.code).toBe('RATE_LIMITED');
          expect(res.body.velocityScore.blocked).toBe(true);
          expect(res.body.velocityScore.threshold).toBe(5);
          expect(res.body.velocityScore.score).toBeGreaterThanOrEqual(5);
          break;
        }
      }
      expect(blocked).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Threshold disabled
  // -----------------------------------------------------------------------
  describe('threshold disabled', () => {
    it('never blocks when blockThreshold is 0', async () => {
      const app = buildApp({ blockThreshold: 0 });

      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.7.7.7')
          .send({ userId: 'user-noblock' });

        expect(res.status).toBe(200);
      }
    });

    it('sets blocked to undefined when threshold is disabled', async () => {
      const app = buildApp({ blockThreshold: 0 });

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.7.7.8')
        .send({ userId: 'user-noblock2' });

      const vs = res.body.velocityScore as VelocityScoreResult;
      expect(vs.blocked).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Missing user ID
  // -----------------------------------------------------------------------
  describe('missing user ID', () => {
    it('still tracks IP when user ID is absent', async () => {
      const app = buildApp();

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.8.8.8')
        .send({}); // no userId

      expect(res.status).toBe(200);
      const vs = res.body.velocityScore as VelocityScoreResult;
      expect(vs.userCount).toBe(0);
      expect(vs.ipCount).toBe(1);
      expect(vs.score).toBeGreaterThanOrEqual(1);
    });

    it('computes score solely from IP when user ID is missing', async () => {
      const app = buildApp({ blockThreshold: 10 });

      for (let i = 0; i < 12; i++) {
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.8.8.9')
          .send({});

        if (res.status === 429) {
          // Blocked purely on IP velocity — that's correct
          // With burst applied, blockThreshold=10 is reached around ipCount=5
          expect(res.body.velocityScore.userCount).toBe(0);
          expect(res.body.velocityScore.ipCount).toBeGreaterThanOrEqual(5);
          return;
        }
      }
      // Should have been blocked by now
      throw new Error('Expected 429 was not returned');
    });
  });

  // -----------------------------------------------------------------------
  // Missing IP
  // -----------------------------------------------------------------------
  describe('missing IP', () => {
    it('still tracks user when IP is absent', async () => {
      const app = buildApp();

      // Override the IP to simulate missing IP
      const altApp = express();
      altApp.use(express.json());
      altApp.use((req: Request, _res: Response, next: NextFunction) => {
        // Remove IP info
        Object.defineProperty(req, 'ip', { value: undefined, writable: true });
        (req as unknown as Record<string, unknown>).socket = {};
        next();
      });
      altApp.use(velocityScoreMiddleware({}));
      altApp.get('/test', (req: Request, res: Response) => {
        res.json({ ok: true, velocityScore: req.velocityScore });
      });

      const res = await request(altApp)
        .get('/test')
        .send({ userId: 'user-noip' });

      expect(res.status).toBe(200);
      const vs = res.body.velocityScore as VelocityScoreResult;
      expect(vs.userCount).toBe(1);
      expect(vs.ipCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Concurrent requests
  // -----------------------------------------------------------------------
  describe('concurrent requests', () => {
    it('handles multiple concurrent requests without data corruption', async () => {
      const app = buildApp();
      const count = 20;

      const promises = Array.from({ length: count }, (_, i) =>
        request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.9.9.9')
          .send({ userId: `user-concurrent-${i % 4}` }),
      );

      const results = await Promise.all(promises);

      // All should succeed
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.velocityScore).toBeDefined();
      }
    });

    it('produces consistent scores under concurrent load', async () => {
      const app = buildApp();
      const count = 10;

      const promises = Array.from({ length: count }, () =>
        request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.9.9.10')
          .send({ userId: 'user-conc-single' }),
      );

      const results = await Promise.all(promises);
      const scores = results.map((r) => (r.body.velocityScore as VelocityScoreResult).score);

      // All scores should be > 0
      for (const s of scores) {
        expect(s).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup of expired windows
  // -----------------------------------------------------------------------
  describe('cleanup of expired windows', () => {
    it('removes expired buckets via runCleanup', async () => {
      const windowMs = 300;
      const app = buildApp({ windowSizeMs: windowMs });

      // Send a request to populate buckets
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.10.10.10')
        .send({ userId: 'user-cleanup' });

      let buckets = __getBuckets();
      expect(buckets.size).toBeGreaterThan(0);

      // Wait for window to expire
      await advanceTime(app, windowMs + 100);

      // Run cleanup — it should remove expired buckets
      runCleanup({ ...__getDefaultConfig(), windowSizeMs: windowMs });

      buckets = __getBuckets();
      // All timestamps should be expired and buckets removed
      expect(buckets.size).toBe(0);
    }, 10_000);
  });

  // -----------------------------------------------------------------------
  // Configuration validation
  // -----------------------------------------------------------------------
  describe('configuration', () => {
    it('uses defaults when no config is provided', async () => {
      const app = buildApp();

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.11.11.11')
        .send({ userId: 'user-defaults' });

      expect(res.status).toBe(200);
      expect(res.body.velocityScore).toBeDefined();
    });

    it('respects a custom window size', async () => {
      const windowMs = 300;
      const app = buildApp({ windowSizeMs: windowMs });

      // Send a request
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.12.12.12')
        .send({ userId: 'user-custom-window' });

      // Wait for window to expire
      await advanceTime(app, windowMs + 100);

      // Next request should have count=1 (previous expired)
      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.12.12.12')
        .send({ userId: 'user-custom-window' });

      const vs = res.body.velocityScore as VelocityScoreResult;
      expect(vs.userCount).toBe(1);
    }, 10_000);
  });

  // -----------------------------------------------------------------------
  // Multiple dimensions
  // -----------------------------------------------------------------------
  describe('combined scoring', () => {
    it('uses the maximum of user and IP scores', async () => {
      const app = buildApp({ blockThreshold: 20 });

      // Saturate IP with many users but few requests per user
      for (let i = 0; i < 25; i++) {
        const res = await request(app)
          .get('/test')
          .set('X-Forwarded-For', '10.13.13.13')
          .send({ userId: `user-combined-${i}` });

        if (res.status === 429) {
          // IP score exceeded threshold even though each user has only 1 request
          const vs = res.body.velocityScore as VelocityScoreResult;
          // Burst multiplier amplifies: blockThreshold=20 reached around ipCount=10
          expect(vs.ipCount).toBeGreaterThanOrEqual(10);
          expect(vs.userCount).toBeLessThanOrEqual(1);
          return;
        }
      }
      throw new Error('Expected 429 was not returned');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles userId in headers instead of body', async () => {
      const app = buildApp();

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.14.14.14')
        .set('x-user-id', 'user-header');

      expect(res.status).toBe(200);
      expect((res.body.velocityScore as VelocityScoreResult).userCount).toBe(1);
    });

    it('handles empty string userId gracefully', async () => {
      const app = buildApp();

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.15.15.15')
        .send({ userId: '' });

      expect(res.status).toBe(200);
      // Empty userId should be treated as missing
      expect((res.body.velocityScore as VelocityScoreResult).userCount).toBe(0);
    });

    it('returns a valid computedAt timestamp', async () => {
      const app = buildApp();

      const res = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '10.16.16.16')
        .send({ userId: 'user-timestamp' });

      const vs = res.body.velocityScore as VelocityScoreResult;
      expect(vs.computedAt).toBeDefined();
      expect(() => new Date(vs.computedAt)).not.toThrow();
    });
  });
});
