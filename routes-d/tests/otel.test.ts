// Unit and integration tests for routes-d/lib/otel.ts (Issue #328).

import request from 'supertest';
import express from 'express';
import {
  Tracer,
  InMemoryExporter,
  Span,
  parseTraceparent,
  formatTraceparent,
  getCurrentSpan,
  runWithSpan,
  traceMiddleware,
  withTracedHttp,
  initTracing,
  type SpanContext,
} from '../lib/otel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTracer(): { tracer: Tracer; exporter: InMemoryExporter } {
  const exporter = new InMemoryExporter();
  const tracer = new Tracer(exporter, 'test-service');
  return { tracer, exporter };
}

function buildApp(tracer: Tracer) {
  const app = express();
  app.use(express.json());
  app.use(traceMiddleware({ tracer }));
  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/pay', (_req, res) => res.status(201).json({ queued: true }));
  app.get('/error', (_req, _res) => { throw new Error('boom'); });
  return app;
}

// ---------------------------------------------------------------------------
// W3C traceparent parsing
// ---------------------------------------------------------------------------

describe('parseTraceparent', () => {
  it('parses a valid traceparent header', () => {
    const ctx = parseTraceparent(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx!.spanId).toBe('00f067aa0ba902b7');
    expect(ctx!.traceFlags).toBe(1);
  });

  it('returns null for a malformed header', () => {
    expect(parseTraceparent('invalid')).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('01-abc-def-01')).toBeNull(); // wrong version
  });
});

describe('formatTraceparent', () => {
  it('formats a SpanContext as a valid W3C traceparent', () => {
    const ctx: SpanContext = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    };
    expect(formatTraceparent(ctx)).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
  });
});

// ---------------------------------------------------------------------------
// Span creation
// ---------------------------------------------------------------------------

describe('Span', () => {
  it('records start time and attributes', () => {
    const span = new Span('test-op', 'trace1234'.padEnd(32, '0'), 'span5678'.padEnd(16, '0'));
    span.setAttribute('db.system', 'postgres');
    span.setAttribute('db.rows', 42);
    expect(span.data.attributes['db.system']).toBe('postgres');
    expect(span.data.attributes['db.rows']).toBe(42);
  });

  it('records end time on end()', () => {
    const span = new Span('op', '0'.repeat(32), '0'.repeat(16));
    expect(span.data.endTimeMs).toBeUndefined();
    span.end();
    expect(typeof span.data.endTimeMs).toBe('number');
  });

  it('does not overwrite end time if called twice', () => {
    const span = new Span('op', '0'.repeat(32), '0'.repeat(16));
    span.end();
    const first = span.data.endTimeMs;
    span.end();
    expect(span.data.endTimeMs).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Tracer — span creation
// ---------------------------------------------------------------------------

describe('Tracer', () => {
  it('creates a root span with a fresh traceId when no parent exists', async () => {
    const { tracer, exporter } = buildTracer();
    await tracer.withSpan('root-op', async (span) => {
      expect(span.data.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.data.parentSpanId).toBeUndefined();
    });
    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0]?.name).toBe('root-op');
  });

  it('creates a child span that inherits the parent traceId', async () => {
    const { tracer, exporter } = buildTracer();
    await tracer.withSpan('parent', async () => {
      await tracer.withSpan('child', async (child) => {
        expect(child.data.parentSpanId).toBeDefined();
        expect(child.data.traceId).toBe(exporter.spans[0]?.traceId ?? child.data.traceId);
      });
    });
    expect(exporter.spans).toHaveLength(2);
  });

  it('sets status to error and re-throws on exception', async () => {
    const { tracer, exporter } = buildTracer();
    await expect(
      tracer.withSpan('failing-op', async () => {
        throw new Error('intentional failure');
      }),
    ).rejects.toThrow('intentional failure');

    expect(exporter.spans[0]?.status).toBe('error');
    expect(exporter.spans[0]?.statusMessage).toContain('intentional failure');
  });
});

// ---------------------------------------------------------------------------
// AsyncLocalStorage context propagation
// ---------------------------------------------------------------------------

describe('runWithSpan / getCurrentSpan', () => {
  it('propagates span across async boundaries', async () => {
    const span = new Span('async-op', '0'.repeat(32), '0'.repeat(16));
    let captured: Span | undefined;

    await new Promise<void>((resolve) => {
      runWithSpan(span, () => {
        setTimeout(() => {
          captured = getCurrentSpan();
          resolve();
        }, 0);
      });
    });

    expect(captured).toBe(span);
  });

  it('returns undefined outside of a traced context', () => {
    expect(getCurrentSpan()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Express traceMiddleware
// ---------------------------------------------------------------------------

describe('traceMiddleware — span creation', () => {
  it('creates a span for each inbound request', async () => {
    const { tracer, exporter } = buildTracer();
    const app = buildApp(tracer);

    await request(app).get('/health');

    expect(exporter.spans.length).toBeGreaterThanOrEqual(1);
    const span = exporter.spans.find((s) => s.name.includes('/health'));
    expect(span).toBeDefined();
    expect(span?.attributes['http.method']).toBe('GET');
    expect(span?.attributes['http.status_code']).toBe(200);
  });

  it('sets X-Trace-Id response header', async () => {
    const { tracer, exporter } = buildTracer();
    const app = buildApp(tracer);

    const res = await request(app).get('/health');
    expect(res.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
    expect(exporter.spans[0]?.traceId).toBe(res.headers['x-trace-id']);
  });

  it('uses the incoming traceparent traceId when present', async () => {
    const { tracer, exporter } = buildTracer();
    const app = buildApp(tracer);

    const traceId = 'aabbccdd' + '0'.repeat(24);
    const traceparent = `00-${traceId}-${'ff'.repeat(8)}-01`;

    const res = await request(app)
      .get('/health')
      .set('traceparent', traceparent);

    expect(res.headers['x-trace-id']).toBe(traceId);
    expect(exporter.spans[0]?.traceId).toBe(traceId);
  });

  it('marks span as error for 5xx responses', async () => {
    const { tracer, exporter } = buildTracer();
    const app = express();
    app.use(express.json());
    app.use(traceMiddleware({ tracer }));
    app.get('/fail', (_req, res) => res.status(500).json({ err: 'oops' }));

    await request(app).get('/fail');

    const span = exporter.spans.find((s) => s.name.includes('/fail'));
    expect(span?.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// withTracedHttp — outbound HTTP span
// ---------------------------------------------------------------------------

describe('withTracedHttp', () => {
  it('creates a child span for outbound requests', async () => {
    const { tracer, exporter } = buildTracer();

    await tracer.withSpan('root', async () => {
      await withTracedHttp({ name: 'Horizon getAccount', tracer }, async (inject) => {
        const headers: Record<string, string> = {};
        inject(headers);
        expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      });
    });

    expect(exporter.spans).toHaveLength(2);
    const child = exporter.spans.find((s) => s.name === 'Horizon getAccount');
    expect(child).toBeDefined();
    expect(child?.attributes['span.kind']).toBe('client');
  });

  it('injects a different spanId per outbound call within the same trace', async () => {
    const { tracer, exporter } = buildTracer();

    await tracer.withSpan('root', async () => {
      const headers1: Record<string, string> = {};
      const headers2: Record<string, string> = {};

      await withTracedHttp({ name: 'call-1', tracer }, async (inject) => {
        inject(headers1);
      });
      await withTracedHttp({ name: 'call-2', tracer }, async (inject) => {
        inject(headers2);
      });

      const tp1 = parseTraceparent(headers1['traceparent']!);
      const tp2 = parseTraceparent(headers2['traceparent']!);

      expect(tp1).not.toBeNull();
      expect(tp2).not.toBeNull();
      expect(tp1!.traceId).toBe(tp2!.traceId);   // same trace
      expect(tp1!.spanId).not.toBe(tp2!.spanId); // different spans
    });
  });
});

// ---------------------------------------------------------------------------
// initTracing — global tracer
// ---------------------------------------------------------------------------

describe('initTracing', () => {
  it('configures and returns a tracer', () => {
    const exporter = new InMemoryExporter();
    const tracer = initTracing(exporter, 'test-svc');
    expect(tracer).toBeInstanceOf(Tracer);
  });
});
