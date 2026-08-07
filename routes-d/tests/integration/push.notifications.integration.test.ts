/**
 * Integration tests for push notification HTTP endpoints
 *
 * Tests the full Express route layer:
 *   POST /push/tokens/:userId
 *   DELETE /push/tokens/:userId/:token
 *   GET  /push/tokens/:userId
 *   POST /push/send/:userId
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import pushRouter, {
  __resetMocks,
  __setMockApnsSend,
  __setMockFcmSend,
  __resetDispatcher,
} from '../../routes/push.notifications.js';
import { __resetTokenStore, __seedTokens } from '../../lib/pushDispatcher.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(pushRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetTokenStore();
  __resetMocks();
  __resetDispatcher();
});

// ---------------------------------------------------------------------------
// POST /push/tokens/:userId
// ---------------------------------------------------------------------------

describe('POST /push/tokens/:userId', () => {
  it('registers a single APNs token', async () => {
    const res = await request(app)
      .post('/push/tokens/user-1')
      .send({ tokens: [{ token: 'apns-abc', platform: 'apns' }] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.registered).toBe(1);
    expect(res.body.userId).toBe('user-1');
  });

  it('registers multiple tokens in a single request', async () => {
    const res = await request(app)
      .post('/push/tokens/user-1')
      .send({
        tokens: [
          { token: 'apns-abc', platform: 'apns' },
          { token: 'fcm-xyz', platform: 'fcm' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.registered).toBe(2);
  });

  it('returns 400 when tokens array is missing', async () => {
    const res = await request(app).post('/push/tokens/user-1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when tokens array is empty', async () => {
    const res = await request(app).post('/push/tokens/user-1').send({ tokens: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when token string is missing', async () => {
    const res = await request(app)
      .post('/push/tokens/user-1')
      .send({ tokens: [{ platform: 'apns' }] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when platform is invalid', async () => {
    const res = await request(app)
      .post('/push/tokens/user-1')
      .send({ tokens: [{ token: 'tok', platform: 'windows' }] });
    expect(res.status).toBe(400);
  });

  it('registers token with quiet hours and timezone', async () => {
    const res = await request(app)
      .post('/push/tokens/user-2')
      .send({
        tokens: [
          {
            token: 'apns-qh',
            platform: 'apns',
            timezone: 'America/New_York',
            quietHours: { start: 22, end: 7 },
          },
        ],
      });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// DELETE /push/tokens/:userId/:token
// ---------------------------------------------------------------------------

describe('DELETE /push/tokens/:userId/:token', () => {
  it('removes an existing token', async () => {
    __seedTokens('user-1', [
      { token: 'apns-del', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
    ]);

    const res = await request(app).delete('/push/tokens/user-1/apns-del');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify it's gone
    const listRes = await request(app).get('/push/tokens/user-1');
    expect(listRes.body.count).toBe(0);
  });

  it('is idempotent when token does not exist', async () => {
    const res = await request(app).delete('/push/tokens/user-1/nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /push/tokens/:userId
// ---------------------------------------------------------------------------

describe('GET /push/tokens/:userId', () => {
  it('returns masked token list for a user', async () => {
    __seedTokens('user-1', [
      {
        token: 'apns-longtoken123',
        platform: 'apns',
        timezone: 'UTC',
        registeredAt: '2025-01-01T00:00:00Z',
      },
    ]);

    const res = await request(app).get('/push/tokens/user-1');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.tokens[0].tokenPrefix).toContain('…');
    expect(res.body.tokens[0].tokenPrefix).not.toBe('apns-longtoken123');
    expect(res.body.tokens[0].platform).toBe('apns');
    expect(res.body.tokens[0].timezone).toBe('UTC');
  });

  it('returns empty list for a user with no tokens', async () => {
    const res = await request(app).get('/push/tokens/unknown-user');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.tokens).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /push/send/:userId
// ---------------------------------------------------------------------------

describe('POST /push/send/:userId', () => {
  it('sends a notification to an APNs token (mock success)', async () => {
    __seedTokens('user-1', [
      { token: 'apns-tok', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
    ]);
    __setMockApnsSend(async () => ({ success: true }));

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ title: 'Hello', body: 'World' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.delivered).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.skipped).toBe(0);
  });

  it('sends a notification to an FCM token (mock success)', async () => {
    __seedTokens('user-1', [
      { token: 'fcm-tok', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
    ]);
    __setMockFcmSend(async () => ({ success: true, messageId: 'msg-1' }));

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ title: 'Alert', body: 'Your payment arrived' });

    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(1);
  });

  it('removes stale token and reports in response', async () => {
    __seedTokens('user-1', [
      { token: 'apns-stale', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
    ]);
    __setMockApnsSend(async () => ({ success: false, reason: 'BadDeviceToken' }));

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ title: 'Hi', body: 'There' });

    expect(res.status).toBe(200);
    expect(res.body.staleTokensRemoved).toBe(1);
    expect(res.body.failed).toBe(1);

    // Token should be gone now
    const listRes = await request(app).get('/push/tokens/user-1');
    expect(listRes.body.count).toBe(0);
  });

  it('returns 404 when user has no tokens registered', async () => {
    const res = await request(app)
      .post('/push/send/nobody')
      .send({ title: 'Hi', body: 'There' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_TOKENS');
  });

  it('returns 400 when title is missing', async () => {
    __seedTokens('user-1', [
      { token: 'tok', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
    ]);

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ body: 'No title here' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body is missing', async () => {
    __seedTokens('user-1', [
      { token: 'tok', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
    ]);

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ title: 'No body here' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('skips tokens in quiet hours and reports in response', async () => {
    // Quiet 0–23 = always quiet
    __seedTokens('user-1', [
      {
        token: 'tok-quiet',
        platform: 'apns',
        timezone: 'UTC',
        quietHours: { start: 0, end: 23 },
        registeredAt: '2025-01-01T00:00:00Z',
      },
    ]);
    __setMockApnsSend(async () => ({ success: true }));

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ title: 'Hi', body: 'There' });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.delivered).toBe(0);
  });

  it('forwards optional fields (data, badge, sound)', async () => {
    __seedTokens('user-1', [
      { token: 'fcm-tok', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedPayload: any = null;
    __setMockFcmSend(async (_token, payload) => {
      capturedPayload = payload;
      return { success: true, messageId: 'x' };
    });

    await request(app)
      .post('/push/send/user-1')
      .send({
        title: 'Rich',
        body: 'Msg',
        data: { action: 'open_wallet' },
        badge: 5,
        sound: 'default',
      });

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.data).toEqual({ action: 'open_wallet' });
    expect(capturedPayload!.badge).toBe(5);
    expect(capturedPayload!.sound).toBe('default');
  });

  it('delivers to multiple mixed-platform tokens in one call', async () => {
    __seedTokens('user-1', [
      { token: 'apns-1', platform: 'apns', registeredAt: '2025-01-01T00:00:00Z' },
      { token: 'fcm-1', platform: 'fcm', registeredAt: '2025-01-01T00:00:00Z' },
    ]);
    __setMockApnsSend(async () => ({ success: true }));
    __setMockFcmSend(async () => ({ success: true, messageId: 'msg' }));

    const res = await request(app)
      .post('/push/send/user-1')
      .send({ title: 'Broadcast', body: 'To all devices' });

    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(2);
    expect(res.body.results).toHaveLength(2);
  });
});
