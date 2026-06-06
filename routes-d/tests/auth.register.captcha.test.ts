// Tests for auth.register route with CAPTCHA verification (Issue #267).
//
// Covers:
//   - 400 on missing captchaToken
//   - 400 on invalid captchaToken (provider rejects)
//   - 400 on invalid body schema (email, password, name)
//   - 201 on valid registration with passing CAPTCHA
//   - captcha.ts unit tests (createHttpCaptchaVerifier)

import express, { type Express } from 'express';
import request from 'supertest';
import { createRegisterRouter, type RegisterDeps } from '../routes/auth.register.js';
import {
  createHttpCaptchaVerifier,
  type CaptchaVerifier,
} from '../lib/captcha.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaptcha(success: boolean, reason?: string): CaptchaVerifier {
  return {
    verify: jest.fn().mockResolvedValue({ success, reason }),
  };
}

function makeCreateUser(
  override?: RegisterDeps['createUser'],
): RegisterDeps['createUser'] {
  return (
    override ??
    jest.fn().mockResolvedValue({ id: 'usr_1', email: 'alice@example.com', displayName: 'Alice' })
  );
}

function buildApp(captcha: CaptchaVerifier, createUser?: RegisterDeps['createUser']): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createRegisterRouter({
      deps: { captcha, createUser: createUser ?? makeCreateUser() },
    }),
  );
  return app;
}

const VALID_BODY = {
  email: 'alice@example.com',
  password: 'SecurePass1',
  name: 'Alice',
  captchaToken: 'valid-token',
};

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('returns 201 with user and session token on valid registration', async () => {
    const captcha = makeCaptcha(true);
    const res = await request(buildApp(captcha)).post('/auth/register').send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.email).toBe('alice@example.com');
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.expiresAt).toBe('number');
    expect(captcha.verify).toHaveBeenCalledWith('valid-token', expect.anything());
  });

  it('returns 400 when captchaToken is missing', async () => {
    const captcha = makeCaptcha(true);
    const { captchaToken: _, ...bodyWithoutCaptcha } = VALID_BODY;
    const res = await request(buildApp(captcha))
      .post('/auth/register')
      .send(bodyWithoutCaptcha);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
    const fields: Array<{ field: string }> = res.body.fields;
    expect(fields.some((f) => f.field === 'captchaToken')).toBe(true);
    expect(captcha.verify).not.toHaveBeenCalled();
  });

  it('returns 400 when captchaToken is an empty string', async () => {
    const captcha = makeCaptcha(true);
    const res = await request(buildApp(captcha))
      .post('/auth/register')
      .send({ ...VALID_BODY, captchaToken: '   ' });

    expect(res.status).toBe(400);
    expect(captcha.verify).not.toHaveBeenCalled();
  });

  it('returns 400 with captcha_failed when provider rejects the token', async () => {
    const captcha = makeCaptcha(false, 'invalid-input-response');
    const res = await request(buildApp(captcha)).post('/auth/register').send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('captcha_failed');
    expect(res.body.reason).toBe('invalid-input-response');
  });

  it('returns 400 with field errors when email is invalid', async () => {
    const captcha = makeCaptcha(true);
    const res = await request(buildApp(captcha))
      .post('/auth/register')
      .send({ ...VALID_BODY, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
    const fields: Array<{ field: string }> = res.body.fields;
    expect(fields.some((f) => f.field === 'email')).toBe(true);
    // CAPTCHA should not be called when schema validation fails.
    expect(captcha.verify).not.toHaveBeenCalled();
  });

  it('returns 400 when password is too short', async () => {
    const captcha = makeCaptcha(true);
    const res = await request(buildApp(captcha))
      .post('/auth/register')
      .send({ ...VALID_BODY, password: 'short' });

    expect(res.status).toBe(400);
    const fields: Array<{ field: string }> = res.body.fields;
    expect(fields.some((f) => f.field === 'password')).toBe(true);
  });

  it('returns 400 when name is too short', async () => {
    const captcha = makeCaptcha(true);
    const res = await request(buildApp(captcha))
      .post('/auth/register')
      .send({ ...VALID_BODY, name: 'A' });

    expect(res.status).toBe(400);
    const fields: Array<{ field: string }> = res.body.fields;
    expect(fields.some((f) => f.field === 'name')).toBe(true);
  });

  it('returns 409 when email is already registered', async () => {
    const captcha = makeCaptcha(true);
    const createUser = jest.fn().mockRejectedValue(new Error('email already exists'));
    const res = await request(buildApp(captcha, createUser))
      .post('/auth/register')
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_already_registered');
  });

  it('passes inviteCode to createUser when provided', async () => {
    const captcha = makeCaptcha(true);
    const createUser = jest.fn().mockResolvedValue({
      id: 'usr_2',
      email: 'bob@example.com',
      displayName: 'Bob',
    });
    await request(buildApp(captcha, createUser))
      .post('/auth/register')
      .send({ ...VALID_BODY, email: 'bob@example.com', name: 'Bob', inviteCode: 'PROMO42' });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCode: 'PROMO42' }),
    );
  });
});

// ---------------------------------------------------------------------------
// captcha.ts unit tests
// ---------------------------------------------------------------------------

describe('createHttpCaptchaVerifier', () => {
  it('returns success=false for an empty token without calling fetch', async () => {
    const fetchMock = jest.fn();
    const verifier = createHttpCaptchaVerifier({
      secretKey: 'secret',
      fetch: fetchMock,
    });

    const result = await verifier.verify('');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('missing_token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns success=true when provider responds with success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    });
    const verifier = createHttpCaptchaVerifier({
      secretKey: 'secret',
      verifyUrl: 'https://example.com/verify',
      fetch: fetchMock,
    });

    const result = await verifier.verify('good-token');
    expect(result.success).toBe(true);
  });

  it('returns success=false with error code when provider rejects', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    });
    const verifier = createHttpCaptchaVerifier({
      secretKey: 'secret',
      verifyUrl: 'https://example.com/verify',
      fetch: fetchMock,
    });

    const result = await verifier.verify('bad-token');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('timeout-or-duplicate');
  });

  it('returns provider_unreachable when fetch throws', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network error'));
    const verifier = createHttpCaptchaVerifier({
      secretKey: 'secret',
      verifyUrl: 'https://example.com/verify',
      fetch: fetchMock,
    });

    const result = await verifier.verify('any-token');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('provider_unreachable');
  });
});
