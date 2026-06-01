# feat(routes-d): idempotency, structured logging, OpenTelemetry tracing, and response compression

## Summary

Implements four infrastructure features inside `routes-d/`, each scoped to that folder.  All new files compile clean under TypeScript strict mode, and every new test passes (61 new tests, 0 regressions introduced).

---

## Changes

### closes #286 — Idempotency key handling for payment routes

**Files changed:**
- `routes-d/middleware/idempotency.ts` — `IdempotencyStore` gains an injectable clock (`now` parameter) to enable deterministic TTL testing.
- `routes-d/routes/payments.send.ts` — `createPaymentSendRouter` accepts `idempotencyOptions` and wires in the middleware before the POST `/send` handler. Pass `false` to opt out.
- `routes-d/routes/payments.refund.ts` — `createRefundRouter` gets the same `idempotencyOptions` wiring for POST `/:id/refund`.
- `routes-d/tests/idempotency.test.ts` — New test file with previously missing coverage: expired-key eviction, concurrent in-flight 409, retry-after-expiry, and end-to-end integration for both payment routes.

---

### closes #326 — Structured JSON logger

**Files added:**
- `routes-d/lib/logger.ts` — `Logger` class that writes a single JSON object per log line to a configurable sink (default: stdout).  Features: configurable minimum level, context fields merged into every entry, automatic deep redaction of PII/secrets (password, token, email, apiKey, phone, etc.), and `child(context)` for per-request loggers that inherit parent context and level.  Module-level singleton `logger` for app-wide use.
- `routes-d/tests/logger.test.ts` — 21 tests covering JSON output format, level filtering (all four levels), direct and nested redaction, child-logger context propagation and isolation, and an Express per-request logger integration pattern.

---

### closes #328 — OpenTelemetry tracing setup

**Files added:**
- `routes-d/lib/otel.ts` — Pure-TypeScript OTel-compatible tracing built on Node.js built-ins (`async_hooks.AsyncLocalStorage`, `node:http/https`, `node:crypto`).  Ships: W3C traceparent parsing/formatting; `Span`, `Tracer`, `SpanExporter`; `InMemoryExporter` (testing), `OtlpHttpExporter` (OTLP/JSON to a collector), `NoopExporter`; `traceMiddleware()` Express middleware (extracts `traceparent`, creates server span, sets `X-Trace-Id`); `withTracedHttp()` for outbound calls (injects `traceparent`, records client span); `initTracing()` / `getTracer()` for global tracer management; fully configurable via `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_TRACE_ENABLED`.
- `routes-d/tests/otel.test.ts` — 22 tests covering traceparent parsing/formatting, span attributes and timing, async context propagation (`AsyncLocalStorage`), inbound Express middleware (span creation, `X-Trace-Id` header, parent trace adoption, error status for 5xx), outbound `withTracedHttp` (child spans, `traceparent` injection, unique span IDs per call), and `initTracing`.

---

### closes #324 — Response compression middleware

**Files added:**
- `routes-d/middleware/compression.ts` — Express middleware using Node's built-in `zlib` (`gzipSync`, `brotliCompressSync`). Intercepts `res.json()` and `res.send()` before bytes hit the socket. Skips compression when: body is below threshold (default 1 KB); client does not advertise a supported encoding; Content-Type is binary (images, etc.). Encoding selection respects `Accept-Encoding` q-values, with server preference order (`['br', 'gzip']` by default) breaking ties. Sets `Vary: Accept-Encoding`, `Content-Encoding`, and updates `Content-Length`.
- `routes-d/tests/middleware/compression.test.ts` — 18 tests covering gzip compression (body parseable after auto-decode, `Vary` header, `Content-Type` preservation), brotli compression, server-preference tie-breaking, no-compression cases (below threshold, `identity` encoding, small body, binary content type), text/plain compression, q-value negotiation (`q=0` exclusion, higher q wins), and custom threshold.

---

## Test plan

- [x] Run `npm test` inside `routes-d/` — all 61 new tests pass.
- [x] No regressions: pre-existing test failures in the suite are unrelated to these changes (missing `jsonwebtoken` in devDependencies, `jest` not imported from `@jest/globals` in some legacy test files).
- [x] TypeScript: all new files compile under `strict` mode with `NodeNext` module resolution.
- [x] Idempotency: expired key, concurrent 409, and payment route wiring verified via integration tests.
- [x] Logger: redaction verified for nested objects and arrays; child logger isolation confirmed.
- [x] OTel: async context propagates across `setTimeout`; `X-Trace-Id` header matches exported span traceId; parent traceId inherited from incoming `traceparent`.
- [x] Compression: brotli preferred over gzip when server lists it first; gzip chosen when client assigns it higher q; binary responses never compressed.

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
