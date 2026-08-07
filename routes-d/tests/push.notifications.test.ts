/**
 * Push Notifications route tests
 * Follows the same flat-file pattern as other routes-d/tests/*.test.ts files.
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import pushRouter, {
  __resetMocks,
  __setMockApnsSend,
  __setMockFcmSend,
  __resetDispatcher,
} from '../routes/push.notifications.js';
import { __resetTokenStore, __seedTokens } from '../lib/pushDispatcher.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(pushRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Push Notifications Route', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTokenStore();
    __resetMocks();
    __resetDispatcher();
  });

  // -------------------------------------------------------------------------
  // Token registration
  // -------------------------------------------------------------------------

  describe('POST /push/tokens/:userId – register', () => {
    it('201 on valid APNs token', async () => {
      const res = await request(app)
        .post('/push/tokens/user-a')
        .send({ tokens: [{ token: 'apns-1', platform: 'apns' }] });
      expect(res.status).toBe(201);
      expect(res.body.registered).toBe(1);
    });

    it('201 on valid FCM token with quiet hours', async () => {
      const res = await request(app)
        .post('/push/tokens/user-a')
        .send({
          tokens: [
            {
              token: 'fcm-1',
              platform: 'fcm',
              timezone: 'Europe/Berlin',
              quietHours: { start: 23, end: 8 },
            },
          ],
        });
      expect(res.status).toBe(201);
    });

    it('400 when tokens field is absent', async () => {
      const res = await request(app).post('/push/tokens/user-a').send({});
      expect(res.status).toBe(400);
    });

    it('400 when platform is unsupported', async () => {
      const res = await request(app)
        .post('/push/tokens/user-a')
        .send({ tokens: [{ token: 'x', platform: 'web' }] });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Token removal
  // -------------------------------------------------------------------------

  describe('DELETE /push/tokens/:userId/:token', () => {
    it('200 and removes token', async () => {
      __seedTokens('user-b', [
        { token: 'tok-del', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
      ]);
      const res = await request(app).delete('/push/tokens/user-b/tok-del');
      expect(res.status).toBe(200);
    });

    it('200 even when token never existed', async () => {
      const res = await request(app).delete('/push/tokens/user-b/ghost');
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Token listing
  // -------------------------------------------------------------------------

  describe('GET /push/tokens/:userId', () => {
    it('200 with masked tokens', async () => {
      __seedTokens('user-c', [
        { token: 'apns-visible-token', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
      ]);
      const res = await request(app).get('/push/tokens/user-c');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      // Full token must not be exposed
      expect(JSON.stringify(res.body)).not.toContain('apns-visible-token');
    });

    it('200 with empty list for unknown user', async () => {
      const res = await request(app).get('/push/tokens/nobody');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Send notification
  // -------------------------------------------------------------------------

  describe('POST /push/send/:userId', () => {
    it('200 with delivered=1 on APNs success', async () => {
      __seedTokens('user-d', [
        { token: 'apns-ok', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
      ]);
      __setMockApnsSend(async () => ({ success: true }));

      const res = await request(app)
        .post('/push/send/user-d')
        .send({ title: 'New payment', body: '50 XLM received' });

      expect(res.status).toBe(200);
      expect(res.body.delivered).toBe(1);
    });

    it('staleTokensRemoved=1 on Unregistered APNs error', async () => {
      __seedTokens('user-d', [
        { token: 'apns-gone', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
      ]);
      __setMockApnsSend(async () => ({ success: false, reason: 'Unregistered' }));

      const res = await request(app)
        .post('/push/send/user-d')
        .send({ title: 'Hi', body: 'There' });

      expect(res.body.staleTokensRemoved).toBe(1);
    });

    it('skipped=1 when device is in quiet hours (always-quiet window)', async () => {
      __seedTokens('user-d', [
        {
          token: 'apns-quiet',
          platform: 'apns',
          timezone: 'UTC',
          quietHours: { start: 0, end: 23 },
          registeredAt: '2025-01-01T00:00:00Z',
        },
      ]);
      __setMockApnsSend(async () => ({ success: true }));

      const res = await request(app)
        .post('/push/send/user-d')
        .send({ title: 'Hi', body: 'Quiet' });

      expect(res.body.skipped).toBe(1);
      expect(res.body.delivered).toBe(0);
    });

    it('404 when user has no tokens', async () => {
      const res = await request(app)
        .post('/push/send/nobody')
        .send({ title: 'Hi', body: 'There' });
      expect(res.status).toBe(404);
    });

    it('400 when title missing', async () => {
      __seedTokens('user-d', [
        { token: 'tok', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
      ]);
      const res = await request(app)
        .post('/push/send/user-d')
        .send({ body: 'Missing title' });
      expect(res.status).toBe(400);
    });

    it('400 when body missing', async () => {
      __seedTokens('user-d', [
        { token: 'tok', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
      ]);
      const res = await request(app)
        .post('/push/send/user-d')
        .send({ title: 'Missing body' });
      expect(res.status).toBe(400);
    });
  });
});
