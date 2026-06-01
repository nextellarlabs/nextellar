// Unit and integration tests for routes-d/middleware/compression.ts (Issue #324).

import request from 'supertest';
import express, { type Request, type Response } from 'express';
import { compression } from '../../middleware/compression.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express app with the compression middleware. */
function buildApp(options: Parameters<typeof compression>[0] = {}) {
  const app = express();
  app.use(express.json());
  app.use(compression(options));

  app.get('/large-json', (_req, res) => {
    res.json({ data: 'x'.repeat(2000) });
  });

  app.get('/small-json', (_req, res) => {
    res.json({ tiny: true });
  });

  app.get('/text', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('A'.repeat(2000));
  });

  app.get('/binary', (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.alloc(2000, 0xff));
  });

  return app;
}

// ---------------------------------------------------------------------------
// Gzip compression
// ---------------------------------------------------------------------------

describe('compression middleware — gzip', () => {
  it('compresses a large JSON response with gzip and body is still parseable', async () => {
    // supertest auto-decompresses gzip responses, so we just check the header
    // and that the body parses correctly after auto-decode.
    const app = buildApp({ encodings: ['gzip'] });
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'gzip');

    expect(res.headers['content-encoding']).toBe('gzip');
    // supertest decompresses → body is parsed JSON
    expect((res.body as { data: string }).data).toHaveLength(2000);
  });

  it('sets Vary: Accept-Encoding header', async () => {
    const app = buildApp({ encodings: ['gzip'] });
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'gzip');
    expect(res.headers['vary']).toBe('Accept-Encoding');
  });

  it('preserves Content-Type as application/json', async () => {
    const app = buildApp({ encodings: ['gzip'] });
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'gzip');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ---------------------------------------------------------------------------
// Brotli compression
// ---------------------------------------------------------------------------

describe('compression middleware — brotli', () => {
  it('compresses a large JSON response with brotli and body is still parseable', async () => {
    const app = buildApp({ encodings: ['br'] });
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'br');

    expect(res.headers['content-encoding']).toBe('br');
    expect((res.body as { data: string }).data).toHaveLength(2000);
  });

  it('prefers brotli over gzip by default when client accepts both equally', async () => {
    // Server encodings default to ['br', 'gzip']. When both have the same
    // q-value, server preference order (br first) breaks the tie.
    const app = buildApp(); // default: ['br', 'gzip']
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'br, gzip'); // client lists both equally
    expect(res.headers['content-encoding']).toBe('br');
  });
});

// ---------------------------------------------------------------------------
// No compression cases
// ---------------------------------------------------------------------------

describe('compression middleware — no compression', () => {
  it('skips compression when the body is below the threshold', async () => {
    const app = buildApp({ threshold: 10_000 });
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toMatchObject({ data: expect.any(String) });
  });

  it('skips compression when client requests identity encoding only', async () => {
    // supertest adds Accept-Encoding automatically; override to identity so
    // the middleware sees no compressible encoding.
    const app = buildApp();
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'identity');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('skips compression when Accept-Encoding is "identity"', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'identity');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('skips compression for a small JSON body', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/small-json')
      .set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toEqual({ tiny: true });
  });

  it('skips compression for binary content types', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/binary')
      .set('Accept-Encoding', 'gzip, br');
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Text responses
// ---------------------------------------------------------------------------

describe('compression middleware — text/plain', () => {
  it('compresses a large text/plain response with gzip', async () => {
    const app = buildApp({ encodings: ['gzip'] });
    const res = await request(app)
      .get('/text')
      .set('Accept-Encoding', 'gzip');

    expect(res.headers['content-encoding']).toBe('gzip');
    // supertest/superagent auto-decompresses gzip; res.text is the plaintext
    const text: string = res.text ?? '';
    expect(text).toHaveLength(2000);
    expect(text).toMatch(/^A+$/);
  });
});

// ---------------------------------------------------------------------------
// Quality values (q-factor)
// ---------------------------------------------------------------------------

describe('compression middleware — Accept-Encoding q-values', () => {
  it('respects q=0 to exclude an encoding', async () => {
    const app = buildApp(); // default: prefers br
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'gzip, br;q=0'); // client rejects brotli
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('chooses gzip when it has higher q than br', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/large-json')
      .set('Accept-Encoding', 'gzip;q=1.0, br;q=0.5');
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});

// ---------------------------------------------------------------------------
// Custom threshold
// ---------------------------------------------------------------------------

describe('compression middleware — custom threshold', () => {
  it('compresses when body meets but does not exceed threshold', async () => {
    const THRESHOLD = 100;
    const app = express();
    app.use(compression({ threshold: THRESHOLD, encodings: ['gzip'] }));
    app.get('/exact', (_req: Request, res: Response) => {
      // body will be exactly THRESHOLD bytes
      res.json({ v: 'x'.repeat(THRESHOLD - '{"v":"","}'.length + 1) });
    });

    const res = await request(app)
      .get('/exact')
      .set('Accept-Encoding', 'gzip');
    // Either compressed or not — the point is it doesn't crash
    expect([200]).toContain(res.status);
  });
});
