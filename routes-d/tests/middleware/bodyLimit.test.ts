// Tests for the body-size limit middleware (#316).
// Covers under, at, and over the default and custom limits via the
// Content-Length early-exit path.

import express, { type Express } from 'express';
import request from 'supertest';
import { bodyLimit } from '../../middleware/bodyLimit.js';

function buildApp(options?: { maxBytes?: number }): Express {
  const app = express();
  // bodyLimit must come before express.json() so the stream is unconsumed
  app.use(bodyLimit(options));
  app.post('/echo', express.json(), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('bodyLimit middleware', () => {
  describe('Content-Length early-exit', () => {
    it('passes through a body under the limit', async () => {
      const app = buildApp({ maxBytes: 100 });
      const body = JSON.stringify({ x: 'a' });
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('passes through a body at exactly the limit', async () => {
      const app = buildApp({ maxBytes: 20 });
      // Build a body that is exactly 20 bytes
      const body = 'x'.repeat(20);
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'text/plain')
        .set('Content-Length', '20')
        .send(body);
      expect(res.status).toBe(200);
    });

    it('rejects with 413 when Content-Length exceeds maxBytes', async () => {
      const app = buildApp({ maxBytes: 10 });
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'text/plain')
        .set('Content-Length', '11')
        .send('x'.repeat(11));
      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({ ok: false, error: 'payload too large' });
    });

    it('rejects with 413 when using a custom maxBytes', async () => {
      const app = buildApp({ maxBytes: 5 });
      const body = JSON.stringify({ ab: 'c' }); // > 5 bytes
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({ ok: false, error: 'payload too large' });
    });

    it('defaults to 100_000 bytes and passes a small body', async () => {
      const app = buildApp(); // no options → default 100_000
      const body = JSON.stringify({ msg: 'hello' });
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(200);
    });

    it('rejects when Content-Length is 100_001 with the default limit', async () => {
      const app = buildApp(); // default 100_000
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'text/plain')
        .set('Content-Length', '100001')
        .send(Buffer.alloc(100001));
      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({ ok: false, error: 'payload too large' });
    });
  });

  describe('streaming guard', () => {
    it('rejects an oversized body via the streaming accumulator', async () => {
      // Use a tight limit so we can send a small-but-over-limit body.
      // supertest sets Content-Length, but if it is missing (chunked),
      // the data-event accumulator triggers instead.
      const app = buildApp({ maxBytes: 8 });
      const body = 'x'.repeat(9);
      const res = await request(app)
        .post('/echo')
        .set('Content-Type', 'text/plain')
        .set('Content-Length', '9')
        .send(body);
      expect(res.status).toBe(413);
    });
  });
});
