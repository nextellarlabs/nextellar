import express from 'express';
import request from 'supertest';
import authRefreshRouter from '../routes/auth.refresh.js';
import {
  refreshTokenStore,
  RefreshTokenStore,
} from '../auth/refreshToken.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authRefreshRouter);
  return app;
}

describe('RefreshTokenStore', () => {
  it('issues a token with a populated family and expiry', () => {
    const store = new RefreshTokenStore(60, () => 1_000_000);
    const issued = store.issue('user-1');
    expect(typeof issued.token).toBe('string');
    expect(issued.token.length).toBeGreaterThan(0);
    expect(issued.familyId).toBeTruthy();
    expect(issued.expiresAt).toBe(1_000_000 + 60_000);
  });

  it('rotates an active token and marks the predecessor as rotated', () => {
    const store = new RefreshTokenStore();
    const first = store.issue('user-1');
    const rotated = store.rotate(first.token);

    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    expect(rotated.result.token).not.toBe(first.token);
    expect(rotated.result.familyId).toBe(first.familyId);

    const predecessor = store.inspect(first.token);
    expect(predecessor?.state).toBe('rotated');
    expect(predecessor?.rotatedTo).toBe(rotated.result.token);

    const successor = store.inspect(rotated.result.token);
    expect(successor?.state).toBe('active');
  });

  it('revokes the whole family when a rotated token is reused', () => {
    const store = new RefreshTokenStore();
    const first = store.issue('user-1');
    const second = store.rotate(first.token);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Attacker replays the already-rotated token.
    const replay = store.rotate(first.token);
    expect(replay).toEqual({ ok: false, reason: 'reuse_detected' });

    // The legitimate next-step token is now revoked too.
    expect(store.inspect(second.result.token)?.state).toBe('revoked');

    // Any further rotation in the chain is rejected as revoked.
    const further = store.rotate(second.result.token);
    expect(further).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects unknown tokens', () => {
    const store = new RefreshTokenStore();
    expect(store.rotate('not-a-real-token')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('rejects expired tokens and marks them revoked', () => {
    let now = 1_000_000;
    const store = new RefreshTokenStore(60, () => now);
    const first = store.issue('user-1');

    now += 61_000; // past expiry
    const rotated = store.rotate(first.token);
    expect(rotated).toEqual({ ok: false, reason: 'expired' });
    expect(store.inspect(first.token)?.state).toBe('revoked');
  });

  it('keeps revokeFamily idempotent', () => {
    const store = new RefreshTokenStore();
    const first = store.issue('user-1');
    store.revokeFamily(first.familyId);
    store.revokeFamily(first.familyId);
    expect(store.inspect(first.token)?.state).toBe('revoked');
  });
});

describe('POST /auth/refresh', () => {
  const app = buildApp();

  beforeEach(() => {
    refreshTokenStore.clear();
  });

  it('rotates an active token and returns the successor', async () => {
    const issued = refreshTokenStore.issue('user-1');

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: issued.token });

    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(issued.token);
    expect(typeof res.body.expiresAt).toBe('number');
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(app).post('/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'refreshToken is required' });
  });

  it('returns 401 for an unknown token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'never-issued' });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('unknown');
  });

  it('reports reuse_detected and revokes the chain on replay', async () => {
    const issued = refreshTokenStore.issue('user-1');

    const first = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: issued.token });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: issued.token });
    expect(replay.status).toBe(401);
    expect(replay.body.reason).toBe('reuse_detected');

    // The successor should now be revoked.
    const successor = first.body.refreshToken as string;
    const followup = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: successor });
    expect(followup.status).toBe(401);
    expect(followup.body.reason).toBe('revoked');
  });
});
