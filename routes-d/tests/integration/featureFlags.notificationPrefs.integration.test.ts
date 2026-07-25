/**
 * Integration tests for #375 Feature Flag Service + #380 Notification Prefs
 *
 * Exercises the two features end-to-end via their HTTP routes:
 *  - Flags hot-reload via POST /flags/reload
 *  - Per-user flag evaluation via GET /flags/user
 *  - Notification prefs CRUD round-trip
 *  - Both features share a user and work independently
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import flagsRouter from '../../routes/flags.js';
import notificationPrefsRouter from '../../routes/notifications.prefs.js';
import {
  __resetFlags,
  __setFlags,
} from '../../lib/featureFlags.js';
import {
  __resetNotificationPrefs,
} from '../../routes/notifications.prefs.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(flagsRouter);
  app.use(notificationPrefsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Feature flags + notification prefs integration', () => {
  let app: express.Express;

  beforeEach(() => {
    __resetFlags();
    __resetNotificationPrefs();
    app = buildApp();
  });

  afterEach(() => {
    delete process.env['FEATURE_FLAGS_JSON'];
    __resetFlags();
    __resetNotificationPrefs();
  });

  it('flag status and notification prefs both respond on the same app', async () => {
    const flagRes = await request(app).get('/flags/status');
    const prefRes = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', 'user-integ');

    expect(flagRes.status).toBe(200);
    expect(prefRes.status).toBe(200);
  });

  it('hot-reload adds a notification-gate flag and user prefs remain independent', async () => {
    // Set a flag that gates access to notification prefs v2
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({
      'notification-prefs-v2': { enabled: true, rollout: 1.0, description: 'v2' },
    });

    await request(app).post('/flags/reload');

    // Flag should be on for the user
    const flagRes = await request(app)
      .get('/flags/user')
      .set('x-user-id', 'user-gate');
    expect(flagRes.body.data.flags['notification-prefs-v2']).toBe(true);

    // The user can still update prefs
    const patchRes = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-gate')
      .send({ payment: ['push', 'email'] });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.preferences.payment).toContain('push');
  });

  it('flag bucketing is stable across flag reloads', async () => {
    __setFlags({ 'stable-gate': { enabled: true, rollout: 0.5 } });

    const uid = 'user-stable-integ-001';

    const res1 = await request(app)
      .get('/flags/user')
      .set('x-user-id', uid);

    // Trigger a reload with the same flags
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({
      'stable-gate': { enabled: true, rollout: 0.5 },
    });
    await request(app).post('/flags/reload');

    const res2 = await request(app)
      .get('/flags/user')
      .set('x-user-id', uid);

    expect(res1.body.data.flags['stable-gate']).toBe(
      res2.body.data.flags['stable-gate'],
    );
  });

  it('complete flow: get defaults → patch prefs → get updated → flags unaffected', async () => {
    const uid = 'integ-full-flow';

    // 1. Get defaults
    const defaults = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', uid);
    expect(defaults.body.data.isDefault).toBe(true);

    // 2. Patch preferences
    await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', uid)
      .send({ security: ['email', 'push'], marketing: [] });

    // 3. Verify update
    const updated = await request(app)
      .get('/notifications/preferences')
      .set('x-user-id', uid);
    expect(updated.body.data.preferences.security).toEqual(
      expect.arrayContaining(['email', 'push']),
    );
    expect(updated.body.data.preferences.marketing).toEqual([]);

    // 4. Flag status is unaffected by prefs changes
    const flagStatus = await request(app).get('/flags/status');
    expect(flagStatus.status).toBe(200);
    expect(flagStatus.body.data.flags).toBeDefined();
  });

  it('rejects bad channel and bad event class with correct codes', async () => {
    const badChannel = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-bad')
      .send({ payment: ['carrier-pigeon'] });
    expect(badChannel.status).toBe(400);
    expect(badChannel.body.error.code).toBe('UNSUPPORTED_CHANNEL');

    const badClass = await request(app)
      .patch('/notifications/preferences')
      .set('x-user-id', 'user-bad')
      .send({ unknown_class: ['email'] });
    expect(badClass.status).toBe(400);
    expect(badClass.body.error.code).toBe('UNKNOWN_EVENT_CLASS');
  });
});
