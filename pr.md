# Pull Request — routes-d: error handler, env reference, Horizon batcher, alerting hooks

## Issues closed

- #325 — Safe error handler middleware in routes-d
- #340 — Environment variables reference inside routes-d
- #354 — Batched Horizon request helper in routes-d
- #334 — Error rate alerting hooks in routes-d

---

## Summary

All changes are scoped to `routes-d/` and follow existing ESM / TypeScript conventions.

### #325 — `routes-d/middleware/errorHandler.ts`

- Typed error hierarchy: `AppError`, `ValidationError`, `AuthenticationError`,
  `AuthorizationError`, `NotFoundError`, `ConflictError`.
- `createErrorHandler(options)` factory returns a four-parameter Express error
  middleware that **redacts** unknown errors to `"Internal server error"` and
  forwards only `AppError` message + code to the client — stack traces never
  leave the server.
- Full internal logging of method, path, status, and raw error is wired to an
  injectable `InternalLogger` (defaults to `console.error` JSON).
- `res.locals.requestId` is forwarded to both the log entry and the response
  body (opt-in, on by default).
- A ready-to-use `errorHandler` export covers the simple case.
- Tests: known-error mapping, unknown-error redaction, stack-trace leakage,
  body-parser 4xx pass-through, logging, requestId propagation.

### #340 — `routes-d/docs/env.md` + `routes-d/.env.example`

- `env.md` documents every env variable consumed by routes-d — name, purpose,
  default value, required flag, and secret flag — grouped by subsystem.
- `.env.example` mirrors the same variables with safe placeholder values and
  inline `# SECRET` markers.
- `routes-d/tests/env.test.ts` lints that:
  1. All env vars read in non-test source files appear in `env.md`.
  2. All variables declared in `.env.example` appear in `env.md`.
  - Bench-only and profiling helper vars (`ROUTES_D_BENCH_*`,
    `ROUTES_D_PROFILE_*`) are explicitly excluded from the runtime contract.

### #354 — `routes-d/lib/horizonBatcher.ts`

- `createHorizonBatcher({ fetch, coalesceMs, onFlush })` returns a batcher
  that deduplicates concurrent fetches for the same Horizon path within a short
  coalescing window (default 10 ms), while issuing distinct paths in parallel.
- `stats()` surfaces `totalRequests`, `totalBatches`, `totalCoalesced`, and
  `hitRate`.
- `onFlush` callback receives `batchSize`, `coalesced`, and
  `flushDurationMs` per flush.
- `flush()` forces immediate dispatch — useful in tests and graceful shutdown.
- Tests: single request, coalescing, distinct-path parallelism, later-window
  re-fetch, forced flush, metrics accuracy, error isolation (one bad path does
  not cancel healthy paths in the same batch).

### #334 — `routes-d/lib/alerts.ts`

- `createAlertsTracker(options)` returns a tracker with a pluggable
  `AlertSink[]` interface (PagerDuty, Slack, etc.).
- Sliding-window per-route error-rate tracking (default: 60 s window,
  10 % threshold, 10 request minimum).
- Fires `AlertEvent` once per spike onset; resets when the rate drops below
  the threshold so the next spike fires a fresh alert.
- Injectable clock (`now`) for deterministic testing.
- Sink errors are swallowed — alerting never disrupts the request path.
- Tests: normal traffic, spike detection, no duplicate alerts during sustained
  spike, recovery → re-spike, route isolation, `stats()` accuracy, window
  pruning, `reset()`, multi-sink, throwing sink resilience, `AlertEvent` shape
  and `triggeredAt` timestamp.

---

## Files changed

```
routes-d/middleware/errorHandler.ts       (new)
routes-d/tests/errorHandler.test.ts      (new)
routes-d/docs/env.md                     (new)
routes-d/.env.example                    (new)
routes-d/tests/env.test.ts               (new)
routes-d/lib/horizonBatcher.ts           (new)
routes-d/tests/horizonBatcher.test.ts    (new)
routes-d/lib/alerts.ts                   (new)
routes-d/tests/alerts.test.ts            (new)
```

No files outside `routes-d/` were modified.

---

## Test plan

```bash
cd routes-d
npm test                        # all routes-d tests via ts-jest ESM
npm test -- --testPathPattern errorHandler
npm test -- --testPathPattern env
npm test -- --testPathPattern horizonBatcher
npm test -- --testPathPattern alerts
```

All new test files follow the `routes-d/tests/**/*.test.ts` pattern and are
picked up automatically by both the `routes-d/jest.config.js` and the root
`jest.config.mjs`.
