import express from 'express';
import request from 'supertest';
import { requireRole } from '../middleware/rbac.js';
import { Roles, asRole } from '../auth/roles.js';

function buildApp(injectedRole: unknown | symbol) {
  const app = express();
  app.use((req, _res, next) => {
    if (injectedRole !== UNAUTHENTICATED) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user = { role: injectedRole };
    }
    next();
  });
  app.get(
    '/admin-only',
    requireRole(Roles.Admin),
    (_req, res) => res.status(200).json({ ok: true }),
  );
  app.get(
    '/staff',
    requireRole(Roles.Admin, Roles.Moderator),
    (_req, res) => res.status(200).json({ ok: true }),
  );
  return app;
}

const UNAUTHENTICATED = Symbol('unauthenticated');

describe('asRole', () => {
  it('returns the role for a known string', () => {
    expect(asRole('admin')).toBe(Roles.Admin);
    expect(asRole('moderator')).toBe(Roles.Moderator);
    expect(asRole('user')).toBe(Roles.User);
  });

  it('rejects unknown strings', () => {
    expect(asRole('superadmin')).toBeNull();
    expect(asRole('')).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(asRole(undefined)).toBeNull();
    expect(asRole(null)).toBeNull();
    expect(asRole(42)).toBeNull();
    expect(asRole({ role: 'admin' })).toBeNull();
  });
});

describe('requireRole', () => {
  it('throws at construction when no roles are supplied', () => {
    expect(() => requireRole(...([] as never[]))).toThrow(
      'requireRole called with empty allow-list',
    );
  });

  it('allows the request when the role matches', async () => {
    const app = buildApp(Roles.Admin);
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows the request when the role matches one of several allowed', async () => {
    const app = buildApp(Roles.Moderator);
    const res = await request(app).get('/staff');
    expect(res.status).toBe(200);
  });

  it('returns 403 when the role is present but not in the allow-list', async () => {
    const app = buildApp(Roles.User);
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'insufficient role' });
  });

  it('returns 403 when the role claim is not a known role string', async () => {
    const app = buildApp('superadmin');
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(403);
  });

  it('returns 403 for non-string role claims', async () => {
    const app = buildApp(42);
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(403);
  });

  it('returns 401 when the role claim is missing entirely', async () => {
    const app = buildApp(UNAUTHENTICATED);
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'authentication required' });
  });

  it('returns 401 when req.user.role is undefined', async () => {
    const app = buildApp(undefined);
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
  });
});
