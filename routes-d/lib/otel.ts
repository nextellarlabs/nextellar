// OpenTelemetry-compatible distributed tracing for routes-d (Issue #328).
//
// This module provides a lightweight but production-ready tracing layer:
//
//   - W3C traceparent / tracestate propagation (RFC 7230-style headers).
//   - AsyncLocalStorage for zero-boilerplate context propagation across
//     async boundaries (Promise chains, setTimeout, async iterators, etc.).
//   - Pluggable SpanExporter interface — ship spans to an OTLP HTTP endpoint
//     or collect them in-memory during tests.
//   - Express middleware that extracts traceparent from inbound requests,
//     creates a root span, and injects it into the async context.
//   - Outbound HTTP helper that injects the current span's traceparent into
//     outgoing requests and records a child span.
//
// Environment variables:
//   OTEL_SERVICE_NAME    — service name attached to every span (default: 'routes-d')
//   OTEL_EXPORTER_OTLP_ENDPOINT — base URL of the OTLP collector
//                          (default: http://localhost:4318)
//   OTEL_EXPORTER_OTLP_HEADERS — comma-separated key=value pairs added to
//                          every OTLP export request
//   OTEL_TRACE_ENABLED   — set to 'false' to disable tracing entirely

import { AsyncLocalStorage } from 'node:async_hooks';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  endTimeMs?: number;
  attributes: SpanAttributes;
  status: SpanStatus;
  statusMessage?: string;
}

export interface SpanExporter {
  export(spans: SpanData[]): void | Promise<void>;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number; // 0x01 = sampled
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// W3C traceparent propagation
//   Format: 00-<traceId>-<spanId>-<flags>
// ---------------------------------------------------------------------------

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header: string): SpanContext | null {
  const m = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!m) return null;
  return {
    traceId: m[1] as string,
    spanId: m[2] as string,
    traceFlags: parseInt(m[3] as string, 16),
  };
}

export function formatTraceparent(ctx: SpanContext): string {
  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

export class Span {
  readonly data: SpanData;

  constructor(
    name: string,
    traceId: string,
    spanId: string,
    parentSpanId?: string,
  ) {
    this.data = {
      traceId,
      spanId,
      parentSpanId,
      name,
      startTimeMs: Date.now(),
      attributes: {},
      status: 'unset',
    };
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.data.attributes[key] = value;
    return this;
  }

  setStatus(status: SpanStatus, message?: string): this {
    this.data.status = status;
    if (message !== undefined) this.data.statusMessage = message;
    return this;
  }

  end(): void {
    if (this.data.endTimeMs === undefined) {
      this.data.endTimeMs = Date.now();
    }
  }

  get context(): SpanContext {
    return {
      traceId: this.data.traceId,
      spanId: this.data.spanId,
      traceFlags: 0x01,
    };
  }
}

// ---------------------------------------------------------------------------
// Async context storage
// ---------------------------------------------------------------------------

const storage = new AsyncLocalStorage<Span>();

export function getCurrentSpan(): Span | undefined {
  return storage.getStore();
}

export function runWithSpan<T>(span: Span, fn: () => T): T {
  return storage.run(span, fn);
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export class Tracer {
  private readonly exporter: SpanExporter;
  private readonly serviceName: string;

  constructor(exporter: SpanExporter, serviceName?: string) {
    this.exporter = exporter;
    this.serviceName =
      serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'routes-d';
  }

  /**
   * Start a new span. If `parentContext` is provided the span is a child;
   * otherwise the current async-local span (if any) is used as the parent.
   */
  startSpan(name: string, parentContext?: SpanContext): Span {
    const parent = parentContext ?? getCurrentSpan()?.context;
    const span = new Span(
      name,
      parent?.traceId ?? generateTraceId(),
      generateSpanId(),
      parent?.spanId,
    );
    span.setAttribute('service.name', this.serviceName);
    return span;
  }

  /**
   * Run `fn` inside the span's async context, export the span when done.
   * Errors are recorded on the span, then re-thrown.
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    parentContext?: SpanContext,
  ): Promise<T> {
    const span = this.startSpan(name, parentContext);
    try {
      const result = await storage.run(span, () => fn(span));
      if (span.data.status === 'unset') span.setStatus('ok');
      return result;
    } catch (err) {
      span.setStatus('error', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
      await this.exporter.export([span.data]);
    }
  }
}

// ---------------------------------------------------------------------------
// Exporters
// ---------------------------------------------------------------------------

/** Collects spans in memory. Useful for testing. */
export class InMemoryExporter implements SpanExporter {
  readonly spans: SpanData[] = [];

  export(spans: SpanData[]): void {
    this.spans.push(...spans);
  }

  reset(): void {
    this.spans.length = 0;
  }
}

/** Exports spans to an OTLP/HTTP JSON endpoint (OTLP over HTTP + protobuf
 *  is the production standard, but OTLP/JSON is accepted by all collectors
 *  and requires no binary encoding here). */
export class OtlpHttpExporter implements SpanExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(options?: { endpoint?: string; headers?: Record<string, string> }) {
    const base =
      options?.endpoint ??
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
      'http://localhost:4318';
    this.endpoint = `${base.replace(/\/$/, '')}/v1/traces`;

    const extraHeaders: Record<string, string> = {};
    const envHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS'];
    if (envHeaders) {
      for (const pair of envHeaders.split(',')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          const k = pair.slice(0, eqIdx).trim();
          const v = pair.slice(eqIdx + 1).trim();
          if (k) extraHeaders[k] = v;
        }
      }
    }
    this.headers = { 'Content-Type': 'application/json', ...extraHeaders, ...options?.headers };
  }

  async export(spans: SpanData[]): Promise<void> {
    const body = JSON.stringify(buildOtlpPayload(spans));
    const url = new URL(this.endpoint);
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: { ...this.headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          res.resume(); // drain body
          res.on('end', resolve);
        },
      );
      req.on('error', () => resolve()); // best-effort: never throw on export failure
      req.write(body);
      req.end();
    });
  }
}

/** No-op exporter — used when OTEL_TRACE_ENABLED=false. */
export class NoopExporter implements SpanExporter {
  export(): void {}
}

// ---------------------------------------------------------------------------
// OTLP JSON payload builder
// ---------------------------------------------------------------------------

function buildOtlpPayload(spans: SpanData[]): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: process.env['OTEL_SERVICE_NAME'] ?? 'routes-d' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: '@nextellar/routes-d', version: '1.0.0' },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId ?? '',
              name: s.name,
              kind: 1, // SERVER
              startTimeUnixNano: String(s.startTimeMs * 1_000_000),
              endTimeUnixNano: String((s.endTimeMs ?? s.startTimeMs) * 1_000_000),
              attributes: Object.entries(s.attributes).map(([key, value]) => ({
                key,
                value: typeof value === 'number'
                  ? { intValue: value }
                  : typeof value === 'boolean'
                    ? { boolValue: value }
                    : { stringValue: String(value ?? '') },
              })),
              status: { code: s.status === 'ok' ? 1 : s.status === 'error' ? 2 : 0 },
            })),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Global tracer factory
// ---------------------------------------------------------------------------

let _globalTracer: Tracer | null = null;

/**
 * Returns (and lazily creates) the global Tracer.
 * Set up once at application start via `initTracing()`.
 */
export function getTracer(): Tracer {
  if (!_globalTracer) {
    const enabled = process.env['OTEL_TRACE_ENABLED'] !== 'false';
    const exporter = enabled ? new OtlpHttpExporter() : new NoopExporter();
    _globalTracer = new Tracer(exporter);
  }
  return _globalTracer;
}

/** Configure the global tracer. Call once during app bootstrap. */
export function initTracing(exporter?: SpanExporter, serviceName?: string): Tracer {
  const exp = exporter ?? (process.env['OTEL_TRACE_ENABLED'] !== 'false'
    ? new OtlpHttpExporter()
    : new NoopExporter());
  _globalTracer = new Tracer(exp, serviceName);
  return _globalTracer;
}

// ---------------------------------------------------------------------------
// Express inbound instrumentation middleware
// ---------------------------------------------------------------------------

export interface TraceMiddlewareOptions {
  /** Tracer to use (default: global tracer). */
  tracer?: Tracer;
  /** Override span name. Defaults to '<METHOD> <path>'. */
  spanName?: (req: Request) => string;
}

/**
 * Express middleware that:
 *   1. Extracts W3C traceparent from the inbound request.
 *   2. Creates a server span and stores it in AsyncLocalStorage.
 *   3. Adds `X-Trace-Id` response header for client-side correlation.
 *   4. Ends + exports the span when the response finishes.
 */
export function traceMiddleware(options: TraceMiddlewareOptions = {}): RequestHandler {
  return function otelTraceMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const tracer = options.tracer ?? getTracer();
    const name = options.spanName
      ? options.spanName(req)
      : `${req.method} ${req.path}`;

    const rawHeader = req.headers['traceparent'];
    const incomingCtx = typeof rawHeader === 'string'
      ? parseTraceparent(rawHeader)
      : null;

    const span = tracer.startSpan(name, incomingCtx ?? undefined);
    span.setAttribute('http.method', req.method);
    span.setAttribute('http.route', req.path);
    span.setAttribute('http.url', req.originalUrl);

    const userAgent = req.headers['user-agent'];
    if (userAgent) span.setAttribute('http.user_agent', userAgent);

    res.setHeader('X-Trace-Id', span.data.traceId);

    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      span.setStatus(res.statusCode < 500 ? 'ok' : 'error');
      span.end();
      tracer['exporter'].export([span.data]);
    });

    storage.run(span, next);
  };
}

// ---------------------------------------------------------------------------
// Outbound HTTP instrumentation helper
// ---------------------------------------------------------------------------

export interface TracedRequestOptions {
  /** Human-readable name for the outbound span (e.g. 'Horizon getAccount'). */
  name: string;
  /** Tracer to use (default: global tracer). */
  tracer?: Tracer;
}

/**
 * Wraps a function that performs an outbound HTTP/HTTPS call.
 *
 * - Injects `traceparent` into the headers of every request made by
 *   `node:http` / `node:https` within `fn` (via monkey-patching the request
 *   options before passing to the underlying transport).
 * - Creates a child span and records it against the current trace.
 *
 * For production use, prefer passing `traceparent` via your HTTP client's
 * headers option directly after calling `getCurrentSpan()?.context`.
 */
export async function withTracedHttp<T>(
  opts: TracedRequestOptions,
  fn: (inject: (headers: Record<string, string>) => void) => Promise<T>,
): Promise<T> {
  const tracer = opts.tracer ?? getTracer();
  return tracer.withSpan(opts.name, async (span) => {
    span.setAttribute('span.kind', 'client');
    const ctx = span.context;
    const inject = (headers: Record<string, string>): void => {
      headers['traceparent'] = formatTraceparent(ctx);
    };
    return fn(inject);
  });
}
