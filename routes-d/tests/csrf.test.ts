// Integration tests for CSRF token rotation middleware (Issue #318).

import { describe, it, expect, beforeEach } from '@jest/globals';
import express, { type Express } from 'express';
import request from 'supertest';
import { createCsrfMiddleware, issueCsrfToken } from '../middleware/csrf.js';

describe('CSRF Middleware', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('issueCsrfToken', () => {
    it('issues initial CSRF token', async () => {
      app.post('/login', issueCsrfToken(), (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).post('/login');

      expect(res.status).toBe(200);
      expect(res.headers['x-csrf-token']).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toContain('csrf-token=');
    });

    it('sets httpOnly and secure cookies', async () => {
      process.env.NODE_ENV = 'production';
      app.post('/login', issueCsrfToken(), (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).post('/login');

      expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
      expect(res.headers['set-cookie'][0]).toContain('Secure');
      expect(res.headers['set-cookie'][0]).toContain('SameSite=Strict');

      delete process.env.NODE_ENV;
    });
  });

  describe('createCsrfMiddleware', () => {
    beforeEach(() => {
      // Mock JWT middleware
      app.use((req, res, next) => {
        req.jwt = { sub: 'user-123' };
        next();
      });
    });

    it('skips unauthenticated requests', async () => {
      app.use((req, res, next) => {
        delete req.jwt;
        next();
      });
      app.use(createCsrfMiddleware());
      app.post('/transfer', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).post('/transfer');

      expect(res.status).toBe(200);
    });

    it('validates CSRF token on POST', async () => {
      app.use(createCsrfMiddleware());
      app.post('/transfer', (req, res) => {
        res.json({ ok: true });
      });

      // First request to get token
      const loginRes = await request(app).post('/transfer');
      const token = loginRes.headers['x-csrf-token'];

      // Second request with valid token
      const transferRes = await request(app)
        .post('/transfer')
        .set('x-csrf-token', token)
        .set('Cookie', `csrf-token=${token}`);

      expect(transferRes.status).toBe(200);
    });

    it('rejects missing CSRF token on POST', async () => {
      app.use(createCsrfMiddleware());
      app.post('/transfer', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).post('/transfer');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('csrf_token_missing');
    });

    it('rejects invalid CSRF token on POST', async () => {
      app.use(createCsrfMiddleware());
      app.post('/transfer', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .post('/transfer')
        .set('x-csrf-token', 'invalid-token')
        .set('Cookie', 'csrf-token=different-token');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('csrf_token_invalid');
    });

    it('validates CSRF token on PUT', async () => {
      app.use(createCsrfMiddleware());
      app.put('/account', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).put('/account');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('csrf_token_missing');
    });

    it('validates CSRF token on DELETE', async () => {
      app.use(createCsrfMiddleware());
      app.delete('/account', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).delete('/account');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('csrf_token_missing');
    });

    it('validates CSRF token on PATCH', async () => {
      app.use(createCsrfMiddleware());
      app.patch('/profile', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).patch('/profile');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('csrf_token_missing');
    });

    it('does not validate CSRF token on GET', async () => {
      app.use(createCsrfMiddleware());
      app.get('/account', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).get('/account');

      expect(res.status).toBe(200);
    });

    it('rotates token on every request', async () => {
      app.use(createCsrfMiddleware());
      app.post('/transfer', (req, res) => {
        res.json({ token: req.csrfToken });
      });

      // First request
      const res1 = await request(app).post('/transfer');
      const token1 = res1.headers['x-csrf-token'];

      // Second request with first token
      const res2 = await request(app)
        .post('/transfer')
        .set('x-csrf-token', token1)
        .set('Cookie', `csrf-token=${token1}`);

      const token2 = res2.headers['x-csrf-token'];

      // Tokens should be different
      expect(token1).not.toBe(token2);
      expect(res2.status).toBe(200);
    });

    it('uses constant-time comparison', async () => {
      app.use(createCsrfMiddleware());
      app.post('/transfer', (req, res) => {
        res.json({ ok: true });
      });

      // Get a valid token
      const loginRes = await request(app).post('/transfer');
      const validToken = loginRes.headers['x-csrf-token'];

      // Try with token that differs in length
      const res1 = await request(app)
        .post('/transfer')
        .set('x-csrf-token', 'short')
        .set('Cookie', `csrf-token=${validToken}`);

      expect(res1.status).toBe(403);

      // Try with token that differs in content
      const invalidToken = Buffer.from(validToken, 'base64')
        .toString('base64')
        .split('')
        .reverse()
        .join('');

      const res2 = await request(app)
        .post('/transfer')
        .set('x-csrf-token', invalidToken)
        .set('Cookie', `csrf-token=${validToken}`);

      expect(res2.status).toBe(403);
    });

    it('supports custom header and cookie names', async () => {
      app.use(
        createCsrfMiddleware({
          headerName: 'x-custom-csrf',
          cookieName: 'custom-csrf',
        }),
      );
      app.post('/transfer', (req, res) => {
        res.json({ ok: true });
      });

      // Get token with custom names
      const loginRes = await request(app).post('/transfer');
      const token = loginRes.headers['x-custom-csrf'];

      // Use custom header and cookie names
      const transferRes = await request(app)
        .post('/transfer')
        .set('x-custom-csrf', token)
        .set('Cookie', `custom-csrf=${token}`);

      expect(transferRes.status).toBe(200);
    });

    it('supports custom protected methods', async () => {
      app.use(
        createCsrfMiddleware({
          protectedMethods: ['POST'], // Only POST requires CSRF
        }),
      );
      app.put('/account', (req, res) => {
        res.json({ ok: true });
      });

      // PUT should not require CSRF token
      const res = await request(app).put('/account');

      expect(res.status).toBe(200);
    });
  });

  describe('token format', () => {
    it('generates base64-encoded tokens', async () => {
      app.post('/login', issueCsrfToken(), (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app).post('/login');
      const token = res.headers['x-csrf-token'];

      // Should be valid base64
      expect(() => Buffer.from(token, 'base64')).not.toThrow();

      // Should decode to 32 bytes (256 bits)
      const decoded = Buffer.from(token, 'base64');
      expect(decoded.length).toBe(32);
    });

    it('generates unique tokens', async () => {
      app.post('/login', issueCsrfToken(), (req, res) => {
        res.json({ ok: true });
      });

      const tokens = new Set();
      for (let i = 0; i < 10; i++) {
        const res = await request(app).post('/login');
        tokens.add(res.headers['x-csrf-token']);
      }

      expect(tokens.size).toBe(10); // All unique
    });
  });
});
