import express from 'express';
import request from 'supertest';
import authPasswordRouter, {
  passwordResetDeps,
} from '../routes/auth.password.js';
import {
  passwordTokenStore,
  PasswordTokenStore,
  PASSWORD_TOKEN_TTL_MS,
} from '../lib/passwordTokens.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authPasswordRouter);
  return app;
}

describe('PasswordTokenStore', () => {
  it('creates a token with a 30-minute TTL by default', () => {
    const store = new PasswordTokenStore(PASSWORD_TOKEN_TTL_MS, () => 1_000_000);
    const record = store.create('user@example.com', 'user-1');
    expect(record.expiresAt - record.issuedAt).toBe(30 * 60 * 1000);
    expect(record.used).toBe(false);
    expect(record.token.length).toBeGreaterThan(0);
  });

  it('consumes a fresh token exactly once', () => {
    const store = new PasswordTokenStore();
    const record = store.create('user@example.com', 'user-1');

    const first = store.consume(record.token);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.record.userId).toBe('user-1');

    const second = store.consume(record.token);
    expect(second).toEqual({ ok: false, reason: 'used' });
  });

  it('rejects unknown tokens', () => {
    const store = new PasswordTokenStore();
    expect(store.consume('not-a-real-token')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('rejects expired tokens', () => {
    let now = 1_000_000;
    const store = new PasswordTokenStore(60_000, () => now);
    const record = store.create('user@example.com', 'user-1');

    now += 61_000;
    const result = store.consume(record.token);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('invalidates the previous active token when a new one is issued', () => {
    const store = new PasswordTokenStore();
    const first = store.create('user@example.com', 'user-1');
    const second = store.create('user@example.com', 'user-1');

    expect(store.inspect(first.token)?.used).toBe(true);
    expect(store.inspect(second.token)?.used).toBe(false);
  });

  it('leaves other users alone when invalidating an active token', () => {
    const store = new PasswordTokenStore();
    const other = store.create('other@example.com', 'user-2');
    store.create('user@example.com', 'user-1');
    expect(store.inspect(other.token)?.used).toBe(false);
  });
});

describe('POST /auth/password/forgot', () => {
  const app = buildApp();
  let sendEmailMock: jest.Mock;
  let resolveUserIdMock: jest.Mock;
  let lastToken: string | undefined;

  beforeEach(() => {
    passwordTokenStore.clear();
    lastToken = undefined;
    sendEmailMock = jest.fn().mockImplementation(async (payload) => {
      lastToken = payload.token;
    });
    resolveUserIdMock = jest.fn().mockResolvedValue('user-1');
    passwordResetDeps.sendResetEmail = sendEmailMock;
    passwordResetDeps.resolveUserId = resolveUserIdMock;
    passwordResetDeps.storeNewPassword = jest.fn().mockResolvedValue(undefined);
  });

  it('issues a token and sends an email for a registered address', async () => {
    const res = await request(app)
      .post('/auth/password/forgot')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(resolveUserIdMock).toHaveBeenCalledWith('user@example.com');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lastToken).toBeDefined();
  });

  it('returns the same 200 body for an unregistered email and does not send', async () => {
    resolveUserIdMock.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/password/forgot')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects invalid email syntax with 400', async () => {
    const res = await request(app)
      .post('/auth/password/forgot')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('POST /auth/password/reset', () => {
  const app = buildApp();
  let storeNewPasswordMock: jest.Mock;

  beforeEach(() => {
    passwordTokenStore.clear();
    storeNewPasswordMock = jest.fn().mockResolvedValue(undefined);
    passwordResetDeps.storeNewPassword = storeNewPasswordMock;
    passwordResetDeps.sendResetEmail = jest.fn().mockResolvedValue(undefined);
    passwordResetDeps.resolveUserId = jest.fn().mockResolvedValue('user-1');
  });

  it('consumes a fresh token and stores the new password', async () => {
    const record = passwordTokenStore.create('user@example.com', 'user-1');

    const res = await request(app)
      .post('/auth/password/reset')
      .send({ token: record.token, password: 'correct-horse-battery' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(storeNewPasswordMock).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'correct-horse-battery',
    });
    expect(passwordTokenStore.inspect(record.token)?.used).toBe(true);
  });

  it('rejects a missing token', async () => {
    const res = await request(app)
      .post('/auth/password/reset')
      .send({ password: 'correct-horse-battery' });
    expect(res.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const record = passwordTokenStore.create('user@example.com', 'user-1');
    const res = await request(app)
      .post('/auth/password/reset')
      .send({ token: record.token, password: 'short' });
    expect(res.status).toBe(400);
    // Token should not be consumed when validation fails.
    expect(passwordTokenStore.inspect(record.token)?.used).toBe(false);
  });

  it('rejects a replayed token with reason=used', async () => {
    const record = passwordTokenStore.create('user@example.com', 'user-1');

    const first = await request(app)
      .post('/auth/password/reset')
      .send({ token: record.token, password: 'correct-horse-battery' });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/auth/password/reset')
      .send({ token: record.token, password: 'another-strong-passphrase' });

    expect(replay.status).toBe(401);
    expect(replay.body.reason).toBe('used');
    expect(storeNewPasswordMock).toHaveBeenCalledTimes(1);
  });

  it('rejects expired tokens with reason=expired', async () => {
    // Bypass the route-level path: poke a stale record into the global
    // store via the time-controlled store helper class, then read back
    // the record via the global so the route sees it.
    let now = Date.now();
    const ephemeral = new PasswordTokenStore(60_000, () => now);
    const record = ephemeral.create('user@example.com', 'user-1');
    // Mirror the record into the global store the route uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (passwordTokenStore as any).tokens.set(record.token, {
      ...record,
      expiresAt: Date.now() - 1, // already expired
    });

    const res = await request(app)
      .post('/auth/password/reset')
      .send({ token: record.token, password: 'correct-horse-battery' });

    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('expired');
    expect(storeNewPasswordMock).not.toHaveBeenCalled();
  });

  it('rejects unknown tokens with reason=unknown', async () => {
    const res = await request(app)
      .post('/auth/password/reset')
      .send({ token: 'never-issued', password: 'correct-horse-battery' });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('unknown');
  });
});
