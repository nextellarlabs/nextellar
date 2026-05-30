# routes-d order suite

Four backlog issues for the orders surface, all scoped under `routes-d/`
per each issue's "Do not modify or add code outside the routes-d/
folder" rule.

## Pieces

| Issue | File(s) | Responsibility |
|-------|---------|----------------|
| #297 | `lib/orderStateMachine.ts`, `routes/orders.update.ts` | Status transition validator + sample `PATCH /orders/:id/status` route that calls `assertTransition` and translates `IllegalTransitionError` into `409 Conflict`. |
| #300 | `routes/orders.search.ts`, `lib/orderIndex.ts` | `GET /orders/search` with validated `q / status / from / to / page / pageSize / sortBy / sortDir` query params. Backed by `InMemoryOrderIndex` (pluggable). |
| #305 | `lib/orderWebhooks.ts` | `OrderWebhookDispatcher` — HMAC-SHA256 signed payloads, exponential backoff on 5xx / 429 / transport failure, fast-fail on 4xx misconfig. |
| #331 | `routes/health.horizon.ts` | `GET /health/horizon` — probes the configured primary (and optional fallback) Horizon endpoint, reports `healthy / stale / unreachable` based on the latest ledger's `closed_at`. |

## Wiring

The pieces compose: `orders.update.ts` accepts an `onTransition` hook
which a host app can wire to an `OrderWebhookDispatcher.dispatch(...)`
so the webhook only fires for legal transitions. Tests demonstrate this
hook fires once per successful update and never for rejected ones.

Search and update share the `OrderStatus` enum surface. The
`orderStateMachine` is the single source of truth for legal transitions.

## Test coverage

| File | Tests |
|------|-------|
| `tests/orderStateMachine.test.ts` | exhaustive legal / illegal matrix; same-state rejection; terminal flag; `assertTransition` throws; route 200 / 400 / 404 / 409; onTransition hook fires exactly once on success and never on rejection. |
| `tests/orders.search.test.ts` | empty result; q-only; multi-filter (q + status); date range; pagination first / last page; `sortBy: amount`; 400 on bad status / from>to / non-int page / negative epoch. |
| `tests/orderWebhooks.test.ts` | HMAC verify roundtrip; tampered body / wrong secret rejected; retry on 5xx then succeed; max-attempts exhausted; 4xx fast-fail; 429 retried; transport-error retried; `isEmittableEvent` allow-list. |
| `tests/health.horizon.test.ts` | classify() pure cases; route 200 healthy; 503 stale; 503 unreachable; primary+fallback healthy via fallback; both-fail unreachable; empty records error. |
