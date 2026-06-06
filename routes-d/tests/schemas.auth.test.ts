/**
 * Unit and integration tests for routes-d/lib/schemas/auth.ts
 *
 * Each schema is tested against:
 *   - a valid minimal payload (must pass)
 *   - a valid payload with every optional field present (must pass)
 *   - multiple invalid shapes: missing required fields, wrong types,
 *     boundary violations, extra fields (must fail with field-level errors)
 *
 * The `parseOrReject` HTTP helper is tested end-to-end with supertest.
 */

import request from 'supertest';
import express from 'express';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  resetRequestSchema,
  resetConfirmSchema,
  parseOrReject,
  AuthSchemaError,
  type FieldError,
} from '../lib/schemas/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldNames(errors: FieldError[]): string[] {
  return errors.map((e) => e.field);
}

// ---------------------------------------------------------------------------
// registerSchema
// ---------------------------------------------------------------------------

describe('registerSchema', () => {
  const valid = { email: 'alice@example.com', password: 'SecurePass1', name: 'Alice' };

  it('accepts a valid registration payload', () => {
    const r = registerSchema.safeParse(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.email).toBe('alice@example.com');
      expect(r.data.name).toBe('Alice');
    }
  });

  it('normalises email to lowercase', () => {
    const r = registerSchema.safeParse({ ...valid, email: 'Alice@Example.COM' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.email).toBe('alice@example.com');
  });

  it('accepts an optional inviteCode', () => {
    const r = registerSchema.safeParse({ ...valid, inviteCode: 'PROMO42' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.inviteCode).toBe('PROMO42');
  });

  it('strips extra / unexpected fields from the output', () => {
    const r = registerSchema.safeParse({ ...valid, isAdmin: true, __proto__: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('rejects a missing email', () => {
    const r = registerSchema.safeParse({ password: valid.password, name: valid.name });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('email');
  });

  it('rejects an invalid email format', () => {
    const r = registerSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].field).toBe('email');
  });

  it('rejects a password shorter than 8 chars', () => {
    const r = registerSchema.safeParse({ ...valid, password: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('password');
  });

  it('rejects a password longer than 128 chars', () => {
    const r = registerSchema.safeParse({ ...valid, password: 'a'.repeat(129) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('password');
  });

  it('rejects a name shorter than 2 chars', () => {
    const r = registerSchema.safeParse({ ...valid, name: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('name');
  });

  it('rejects a non-object body with a _root error', () => {
    const r = registerSchema.safeParse('not-an-object');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].field).toBe('_root');
  });

  it('accumulates multiple field errors in a single result', () => {
    const r = registerSchema.safeParse({ email: 'bad', password: 'x', name: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = fieldNames(r.errors);
      expect(fields).toContain('email');
      expect(fields).toContain('password');
      expect(fields).toContain('name');
    }
  });

  it('parse() throws AuthSchemaError on invalid input', () => {
    expect(() => registerSchema.parse({ email: 'bad' })).toThrow(AuthSchemaError);
  });
});

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------

describe('loginSchema', () => {
  const valid = { email: 'bob@example.com', password: 'Password123' };

  it('accepts a valid login payload', () => {
    const r = loginSchema.safeParse(valid);
    expect(r.ok).toBe(true);
  });

  it('strips extra fields', () => {
    const r = loginSchema.safeParse({ ...valid, role: 'admin', extra: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as Record<string, unknown>).role).toBeUndefined();
      expect((r.data as Record<string, unknown>).extra).toBeUndefined();
    }
  });

  it('rejects a missing password', () => {
    const r = loginSchema.safeParse({ email: valid.email });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('password');
  });

  it('rejects a password as a number', () => {
    const r = loginSchema.safeParse({ email: valid.email, password: 12345678 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('password');
  });

  it('rejects null as the body', () => {
    const r = loginSchema.safeParse(null);
    expect(r.ok).toBe(false);
  });

  it('rejects an array body', () => {
    const r = loginSchema.safeParse([]);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refreshSchema
// ---------------------------------------------------------------------------

describe('refreshSchema', () => {
  const validToken = 'eyJhbGciOiJIUzI1NiJ9.validpayload.signature';

  it('accepts a valid refresh token', () => {
    const r = refreshSchema.safeParse({ refreshToken: validToken });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.refreshToken).toBe(validToken);
  });

  it('rejects a missing refreshToken field', () => {
    const r = refreshSchema.safeParse({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('refreshToken');
  });

  it('rejects a token with invalid characters', () => {
    const r = refreshSchema.safeParse({ refreshToken: 'has spaces and <script>' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('refreshToken');
  });

  it('rejects a token longer than 256 characters', () => {
    const r = refreshSchema.safeParse({ refreshToken: 'a'.repeat(257) });
    expect(r.ok).toBe(false);
  });

  it('strips extra fields', () => {
    const r = refreshSchema.safeParse({ refreshToken: validToken, userId: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as Record<string, unknown>).userId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resetRequestSchema
// ---------------------------------------------------------------------------

describe('resetRequestSchema', () => {
  it('accepts a valid email', () => {
    const r = resetRequestSchema.safeParse({ email: 'carol@example.com' });
    expect(r.ok).toBe(true);
  });

  it('rejects a missing email', () => {
    const r = resetRequestSchema.safeParse({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('email');
  });

  it('rejects a malformed email', () => {
    const r = resetRequestSchema.safeParse({ email: 'carol-at-example.com' });
    expect(r.ok).toBe(false);
  });

  it('strips extra fields', () => {
    const r = resetRequestSchema.safeParse({ email: 'carol@example.com', token: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as Record<string, unknown>).token).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resetConfirmSchema
// ---------------------------------------------------------------------------

describe('resetConfirmSchema', () => {
  const valid = { token: 'abc123XYZ', newPassword: 'NewSecure99' };

  it('accepts a valid confirm payload', () => {
    const r = resetConfirmSchema.safeParse(valid);
    expect(r.ok).toBe(true);
  });

  it('rejects a missing token', () => {
    const r = resetConfirmSchema.safeParse({ newPassword: valid.newPassword });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('token');
  });

  it('rejects a missing newPassword', () => {
    const r = resetConfirmSchema.safeParse({ token: valid.token });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('newPassword');
  });

  it('rejects a weak newPassword', () => {
    const r = resetConfirmSchema.safeParse({ ...valid, newPassword: 'weak' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('newPassword');
  });

  it('rejects a token with invalid characters', () => {
    const r = resetConfirmSchema.safeParse({ ...valid, token: 'bad token!' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(fieldNames(r.errors)).toContain('token');
  });

  it('accumulates token + password errors together', () => {
    const r = resetConfirmSchema.safeParse({ token: 'bad!', newPassword: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = fieldNames(r.errors);
      expect(fields).toContain('token');
      expect(fields).toContain('newPassword');
    }
  });
});

// ---------------------------------------------------------------------------
// parseOrReject HTTP helper (integration)
// ---------------------------------------------------------------------------

describe('parseOrReject (HTTP integration)', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());

    app.post('/auth/login', (req, res) => {
      const payload = parseOrReject(loginSchema, req.body, res);
      if (!payload) return;
      res.status(200).json({ ok: true, email: payload.email });
    });

    app.post('/auth/register', (req, res) => {
      const payload = parseOrReject(registerSchema, req.body, res);
      if (!payload) return;
      res.status(201).json({ ok: true, email: payload.email });
    });

    return app;
  }

  it('returns 200 with typed payload on a valid login body', async () => {
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ email: 'dave@example.com', password: 'Password123' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('dave@example.com');
  });

  it('returns 400 with validation_failed and field errors on invalid login', async () => {
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
    expect(Array.isArray(res.body.fields)).toBe(true);
    const fields = (res.body.fields as FieldError[]).map((f) => f.field);
    expect(fields).toContain('email');
    expect(fields).toContain('password');
  });

  it('returns 400 when the body is not a JSON object', async () => {
    const res = await request(buildApp())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('"just a string"');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('returns 201 on a valid register payload', async () => {
    const res = await request(buildApp())
      .post('/auth/register')
      .send({ email: 'eve@example.com', password: 'Password123', name: 'Eve' });
    expect(res.status).toBe(201);
  });

  it('returns 400 with field-level detail on an invalid register payload', async () => {
    const res = await request(buildApp())
      .post('/auth/register')
      .send({ email: 'bad', password: 'x', name: 'E' });
    expect(res.status).toBe(400);
    const fields = (res.body.fields as FieldError[]).map((f) => f.field);
    expect(fields.length).toBeGreaterThanOrEqual(3);
  });
});