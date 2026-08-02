/**
 * Route tests for routes-d/routes/flags.ts
 *
 * Covers:
 *  - GET /flags/status returns flag definitions
 *  - GET /flags/user requires x-user-id header
 *  - GET /flags/user returns per-user evaluated flags
 *  - POST /flags/reload triggers hot reload and returns metadata
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import flagsRouter from '../routes/flags.js';
import {
  __resetFlags,
  __setFlags,
  type FlagMap,
} from '../lib/featureFlags.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(flagsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe('GET /flags/status', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetFlags();
  });

  it('returns 200 with success: true', async () => {
    const res = await request(app).get('/flags/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns flags, loadedAt, and source in data', async () => {
    const res = await request(app).get('/flags/status');
    const { data } = res.body;
    expect(data).toBeDefined();
    expect(data.flags).toBeDefined();
    expect(data.loadedAt).toBeDefined();
    expect(data.source).toBeDefined();
  });

  it('returns the injected flags', async () => {
    const custom: FlagMap = {
      'my-test-flag': { enabled: true, rollout: 0.5, description: 'test' },
    };
    __setFlags(custom);

    const res = await request(app).get('/flags/status');
    const { flags } = res.body.data;
    expect(flags['my-test-flag']).toBeDefined();
    expect(flags['my-test-flag'].enabled).toBe(true);
    expect(flags['my-test-flag'].rollout).toBe(0.5);
    expect(flags['my-test-flag'].description).toBe('test');
  });

  it('includes all default flags', async () => {
    __resetFlags();
    const res = await request(app).get('/flags/status');
    const { flags } = res.body.data;
    expect(flags['stellar-soroban-v2']).toBeDefined();
    expect(flags['notification-prefs-v2']).toBeDefined();
  });
});

describe('GET /flags/user', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetFlags();
  });

  it('returns 401 UNAUTHORIZED when x-user-id header is missing', async () => {
    const res = await request(app).get('/flags/user');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED when x-user-id is an empty string', async () => {
    const res = await request(app)
      .get('/flags/user')
      .set('x-user-id', '  ');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with userId and flags for a valid user', async () => {
    __setFlags({
      'flag-on': { enabled: true, rollout: 1.0 },
      'flag-off': { enabled: false, rollout: 1.0 },
    });

    const res = await request(app)
      .get('/flags/user')
      .set('x-user-id', 'user-123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe('user-123');
    expect(typeof res.body.data.flags).toBe('object');
  });

  it('enabled flag with rollout 1.0 is true for the user', async () => {
    __setFlags({ 'always-on': { enabled: true, rollout: 1.0 } });

    const res = await request(app)
      .get('/flags/user')
      .set('x-user-id', 'any-user');

    expect(res.body.data.flags['always-on']).toBe(true);
  });

  it('disabled flag is false for the user', async () => {
    __setFlags({ 'always-off': { enabled: false, rollout: 1.0 } });

    const res = await request(app)
      .get('/flags/user')
      .set('x-user-id', 'any-user');

    expect(res.body.data.flags['always-off']).toBe(false);
  });

  it('returns consistent results on repeated calls for the same user', async () => {
    __setFlags({ 'stable': { enabled: true, rollout: 0.5 } });

    const uid = 'stable-user-abc';
    const res1 = await request(app).get('/flags/user').set('x-user-id', uid);
    const res2 = await request(app).get('/flags/user').set('x-user-id', uid);

    expect(res1.body.data.flags['stable']).toBe(
      res2.body.data.flags['stable'],
    );
  });
});

describe('POST /flags/reload', () => {
  afterEach(() => {
    delete process.env['FEATURE_FLAGS_JSON'];
    __resetFlags();
  });

  it('returns 200 with reloaded: true', async () => {
    const app = buildApp();
    const res = await request(app).post('/flags/reload');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reloaded).toBe(true);
  });

  it('returns envProvided: false when FEATURE_FLAGS_JSON is not set', async () => {
    delete process.env['FEATURE_FLAGS_JSON'];
    __resetFlags();
    const app = buildApp();
    const res = await request(app).post('/flags/reload');
    expect(res.body.data.envProvided).toBe(false);
    expect(res.body.data.source).toBe('default');
  });

  it('returns envProvided: true when FEATURE_FLAGS_JSON is valid', async () => {
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({
      'env-test': { enabled: true, rollout: 1.0 },
    });
    const app = buildApp();
    const res = await request(app).post('/flags/reload');
    expect(res.body.data.envProvided).toBe(true);
    expect(res.body.data.source).toBe('env');
  });

  it('includes flagCount in the response', async () => {
    __setFlags({ 'a': { enabled: true }, 'b': { enabled: false } });
    const app = buildApp();
    const res = await request(app).post('/flags/reload');
    expect(typeof res.body.data.flagCount).toBe('number');
    expect(res.body.data.flagCount).toBeGreaterThan(0);
  });

  it('includes loadedAt as an ISO date string', async () => {
    const app = buildApp();
    const res = await request(app).post('/flags/reload');
    expect(res.body.data.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('picks up new flags from env after reload', async () => {
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({
      'hot-reloaded-flag': { enabled: true, rollout: 1.0 },
    });
    const app = buildApp();
    await request(app).post('/flags/reload');

    const statusRes = await request(app).get('/flags/status');
    expect(statusRes.body.data.flags['hot-reloaded-flag']).toBeDefined();
  });
});
