/**
 * Tests for routes-d/routes/notifications.prefs.ts
 *
 * Covers:
 *  - GET  /notifications/preferences – auth, defaults, per-user isolation
 *  - PATCH /notifications/preferences – update, validation, no-op, channel dedup
 *  - Unsupported channel rejection
 *  - Unknown event class rejection
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import notificationPrefsRouter, {
  __resetNotificationPrefs,
  __seedNotificationPrefs,
  __getNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  SUPPORTED_CHANNELS,
  SUPPORTED_EVENT_CLASSES,
  type NotificationPreferences,
} from '../routes/notifications.prefs.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(notificationPrefsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// GET /notifications/preferences
// ---------------------------------------------------------------------------
describe('GET /notifications/preferences', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNotificationPrefs();
  });

  it('returns 401 UNAUTHORIZED when x-user-id header is missing', async () => {
    const res = await request(app).get('/notifications/preferences');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED when x-user-id is blank', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', '   ');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with success: true for a valid user', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns documented default preferences for a new user', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'new-user');

    expect(res.status).toBe(200);
    const { preferences, isDefault } = res.body.data;

    expect(isDefault).toBe(true);

    // Verify each default event class and its channels
    for (const [cls, channels] of Object.entries(DEFAULT_NOTIFICATION_PREFS)) {
      expect(preferences[cls]).toBeDefined();
      for (const ch of channels) {
        expect(preferences[cls]).toContain(ch);
      }
    }
  });

  it('security event class defaults to all four channels', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-security');

    expect(res.body.data.preferences.security).toEqual(
      expect.arrayContaining(['email', 'sms', 'push', 'in_app']),
    );
  });

  it('returns persisted preferences when they exist for the user', async () => {
    const custom: NotificationPreferences = {
      payment: ['push'],
      transfer: ['sms'],
      security: ['email'],
      marketing: [],
      system: ['in_app'],
    };
    __seedNotificationPrefs('user-seeded', custom);

    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-seeded');

    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(false);
    expect(res.body.data.preferences.payment).toEqual(['push']);
    expect(res.body.data.preferences.transfer).toEqual(['sms']);
    expect(res.body.data.preferences.marketing).toEqual([]);
  });

  it('isolates preferences between users', async () => {
    __seedNotificationPrefs('user-a', {
      payment: ['push'],
      transfer: ['sms'],
      security: ['email'],
      marketing: [],
      system: [],
    });

    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-b');

    expect(res.body.data.preferences.payment).toEqual(
      expect.arrayContaining(DEFAULT_NOTIFICATION_PREFS.payment),
    );
  });

  it('returns userId in response body', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-xyz');
    expect(res.body.data.userId).toBe('user-xyz');
  });
});

// ---------------------------------------------------------------------------
// PATCH /notifications/preferences
// ---------------------------------------------------------------------------
describe('PATCH /notifications/preferences', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNotificationPrefs();
  });

  it('returns 401 UNAUTHORIZED when x-user-id header is missing', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .send({ payment: ['email'] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('updates a single event class channel list', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-1')
      .send({ payment: ['push', 'sms'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.preferences.payment).toEqual(
      expect.arrayContaining(['push', 'sms']),
    );
  });

  it('persists the update and GET reflects the new value', async () => {
    await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-2')
      .send({ marketing: ['sms', 'push'] });

    const get = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-2');

    expect(get.body.data.preferences.marketing).toEqual(
      expect.arrayContaining(['sms', 'push']),
    );
    expect(get.body.data.isDefault).toBe(false);
  });

  it('can set a channel list to empty array (opt out of all channels)', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-3')
      .send({ marketing: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.preferences.marketing).toEqual([]);
  });

  it('deduplicates channels in the update', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-4')
      .send({ payment: ['email', 'email', 'sms', 'sms'] });

    expect(res.status).toBe(200);
    const channels: string[] = res.body.data.preferences.payment;
    const unique = new Set(channels);
    expect(channels.length).toBe(unique.size);
  });

  it('updates multiple event classes atomically', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-5')
      .send({ payment: ['push'], transfer: ['sms'], marketing: [] });

    expect(res.status).toBe(200);
    const { preferences } = res.body.data;
    expect(preferences.payment).toEqual(expect.arrayContaining(['push']));
    expect(preferences.transfer).toEqual(expect.arrayContaining(['sms']));
    expect(preferences.marketing).toEqual([]);
  });

  it('unaffected event classes keep their previous values', async () => {
    __seedNotificationPrefs('user-6', {
      payment: ['email'],
      transfer: ['in_app'],
      security: ['email', 'sms'],
      marketing: ['email'],
      system: ['push'],
    });

    await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-6')
      .send({ payment: ['push'] });

    const stored = __getNotificationPrefs('user-6');
    expect(stored?.transfer).toEqual(['in_app']);
    expect(stored?.security).toEqual(['email', 'sms']);
    expect(stored?.marketing).toEqual(['email']);
    expect(stored?.system).toEqual(['push']);
  });

  it('returns updated: false and current prefs for an empty body', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-7')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(false);
    expect(res.body.data.preferences).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Validation – unsupported channels
  // -------------------------------------------------------------------------

  it('returns 400 UNSUPPORTED_CHANNEL for an unknown channel', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-8')
      .send({ payment: ['email', 'telegram'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_CHANNEL');
  });

  it('includes the unsupported channel name in the error message', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-9')
      .send({ payment: ['slack'] });

    expect(res.body.error.message).toMatch(/slack/i);
  });

  // -------------------------------------------------------------------------
  // Validation – unknown event classes
  // -------------------------------------------------------------------------

  it('returns 400 UNKNOWN_EVENT_CLASS for an unrecognised event class', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-10')
      .send({ foobar: ['email'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_EVENT_CLASS');
  });

  it('includes the unknown class name in the error message', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-11')
      .send({ custom_alerts: ['push'] });

    expect(res.body.error.message).toMatch(/custom_alerts/i);
  });

  // -------------------------------------------------------------------------
  // Validation – non-array channel value
  // -------------------------------------------------------------------------

  it('returns 400 INVALID_CHANNEL_LIST when channel value is a string', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-12')
      .send({ payment: 'email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CHANNEL_LIST');
  });

  it('returns 400 INVALID_CHANNEL_LIST when channel value is a boolean', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-13')
      .send({ payment: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CHANNEL_LIST');
  });

  it('returns 400 INVALID_CHANNEL_LIST when channel value is null', async () => {
    const res = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-14')
      .send({ payment: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CHANNEL_LIST');
  });

  // -------------------------------------------------------------------------
  // All supported channels are accepted
  // -------------------------------------------------------------------------

  it.each([...SUPPORTED_CHANNELS])(
    'accepts "%s" as a valid channel',
    async (channel) => {
      const res = await request(app)
        .patch('/notifications/preferences')
        .set('x-user-id', `user-ch-${channel}`)
        .send({ payment: [channel] });

      expect(res.status).toBe(200);
    },
  );

  // -------------------------------------------------------------------------
  // All supported event classes are accepted
  // -------------------------------------------------------------------------

  it.each([...SUPPORTED_EVENT_CLASSES])(
    'accepts "%s" as a valid event class',
    async (cls) => {
      const res = await request(app)
        .patch('/notifications/preferences')
        .set('x-user-id', `user-cls-${cls}`)
        .send({ [cls]: ['email'] });

      expect(res.status).toBe(200);
    },
  );
});

// ---------------------------------------------------------------------------
// Integration: GET → PATCH → GET round-trip
// ---------------------------------------------------------------------------
describe('notifications.prefs integration round-trip', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNotificationPrefs();
  });

  it('GET returns defaults → PATCH updates → GET reflects changes', async () => {
    const uid = 'integration-user-1';

    const initial = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', uid);

    expect(initial.body.data.isDefault).toBe(true);
    expect(initial.body.data.preferences.payment).toEqual(
      expect.arrayContaining(DEFAULT_NOTIFICATION_PREFS.payment),
    );

    await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', uid)
      .send({ payment: ['push'], marketing: [] });

    const updated = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', uid);

    expect(updated.body.data.isDefault).toBe(false);
    expect(updated.body.data.preferences.payment).toEqual(
      expect.arrayContaining(['push']),
    );
    expect(updated.body.data.preferences.marketing).toEqual([]);
    // Other classes unchanged from defaults
    expect(updated.body.data.preferences.security).toEqual(
      expect.arrayContaining(DEFAULT_NOTIFICATION_PREFS.security),
    );
  });

  it('multiple users can have independent preferences', async () => {
    await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'multi-user-a')
      .send({ payment: ['sms'] });

    await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'multi-user-b')
      .send({ payment: ['push'] });

    const aRes = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'multi-user-a');

    const bRes = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'multi-user-b');

    expect(aRes.body.data.preferences.payment).toContain('sms');
    expect(bRes.body.data.preferences.payment).toContain('push');
    expect(aRes.body.data.preferences.payment).not.toContain('push');
    expect(bRes.body.data.preferences.payment).not.toContain('sms');
  });
});
