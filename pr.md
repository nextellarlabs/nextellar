# Pull Request: Checkout Rollback, Redis Account Cache, Request ID Middleware & Testing Guide

## Summary

This PR resolves four open issues across the `backend/` and `routes-d/` packages.

---

### #221 — `backend`: atomic transaction rollback on POST /checkout

**Files changed:**
- `backend/routes/checkout.ts` *(new)*
- `backend/__tests__/checkout.test.ts` *(new)*
- `backend/app.ts` *(updated — registers `/v1/checkout`)*

**What changed:**
POST `/checkout` previously performed three sequential writes (create order →
deduct inventory → charge payment) without any atomicity guarantee. A payment
failure left a ghost order and incorrect stock counts in the datastore.

The new implementation wraps all three writes in a logical transaction:

1. `createOrder` — appends the order record.
2. `deductInventory` — reduces stock for each line item; throws if any item is
   undersupplied.
3. `chargePayment` — calls the payment provider; honours the
   `SIMULATE_PAYMENT_FAILURE` env flag for testing.

On any thrown error the handler rolls back in reverse write order:
`rollbackInventory` then `rollbackOrder`. The response is only `201` when all
three steps succeed.

**Tests:**
- Happy-path: `201` with `orderId` and `total`.
- Payment failure (via `SIMULATE_PAYMENT_FAILURE=true`): order count and
  inventory are both unchanged after rollback.
- Insufficient stock: no order created.
- Validation: `400` for missing `userId` or empty `items`.

---

### #346 — `routes-d`: Redis-backed cache for account data

**Files changed:**
- `routes-d/lib/redisClient.ts` *(new)*
- `routes-d/lib/accountCache.ts` *(new)*
- `routes-d/tests/redisClient.test.ts` *(new)*
- `routes-d/tests/accountCache.test.ts` *(new)*

**What changed:**
Introduces a two-layer Redis abstraction:

`redisClient.ts` — defines the `IRedisClient` interface (compatible with
ioredis/node-redis) and an `InMemoryRedisClient` stub that satisfies the
interface without requiring a running Redis server. A module-level singleton
(`getRedisClient`) reads connection config from env vars (`REDIS_URL`,
`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS`). A
`checkRedisHealth` helper is provided for health-check routes.

`accountCache.ts` — `AccountCache` wraps the Redis client to cache the three
hot account data shapes (profile, tier, trust state) under predictable key
patterns (`account:<id>:profile` etc.) with configurable TTL
(`ACCOUNT_CACHE_TTL_SECS`, default 120 s). Callers can bypass the cache with
`forceRefresh: true`. Per-field invalidation (`invalidateProfile`,
`invalidateTier`, `invalidateTrust`) and full-account invalidation
(`invalidateAccount`) are exposed so account-update routes can purge stale
entries.

**Tests:**
- `redisClient.test.ts`: set/get/del/ping/quit, TTL expiry via `Date.now` spy,
  singleton lifecycle (get/set/reset), `checkRedisHealth` happy and broken paths.
- `accountCache.test.ts`: cache miss (fetcher called), cache hit (fetcher
  skipped), `forceRefresh` bypass, per-field invalidation, full-account
  invalidation, account isolation.

---

### #327 — `routes-d`: request ID correlation middleware

**Files changed:**
- `routes-d/middleware/requestId.ts` *(new)*
- `routes-d/tests/middleware/requestId.test.ts` *(new)*

**What changed:**
`requestId` middleware:
- Honors an incoming `X-Request-Id` header (trimmed) if present.
- Generates a UUID v4 via Node's built-in `crypto.randomUUID()` otherwise.
- Attaches the ID to `res.locals.requestId` for downstream handlers.
- Echoes the ID in the `X-Request-Id` response header for client correlation.
- When `req.log` is present it replaces it with `req.log.child({ requestId })`
  so every logger call made during the request automatically carries the ID.
- Falls back gracefully when no logger is mounted.

**Tests:**
- Echo incoming ID; generate UUID when absent; uniqueness across concurrent
  requests; `res.locals.requestId` population; child-logger binding; edge cases
  (empty string falls back to UUID, whitespace is trimmed).

---

### #344 — `routes-d`: testing guide

**Files changed:**
- `routes-d/docs/testing.md` *(new)*

**What changed:**
Comprehensive testing documentation under `routes-d/docs/` covering:
- Quick start (`npm test`, `npm run test:unit`, `npm run test:integration`,
  coverage).
- **Unit tests** — isolation conventions, in-process stubs, fake timers,
  example.
- **Integration tests** — supertest patterns, state reset, assert on HTTP
  contracts, example.
- **Snapshot tests** — when to use them, update workflow, commit policy.
- **Fuzz tests** — `fast-check` usage, iteration limits, no-I/O rule, example.
- **Load / benchmark tests** — `tests/bench/` location, `_recorder.ts` helper,
  manual execution, CI exclusion.
- **Fixture conventions** — one concern per file, no real credentials, minimal
  payloads, refresh guidance.
- **Flaky tests** — root causes, `// FLAKY:` + `it.skip` marking convention,
  triage steps, issue-linking.
- **CI integration** — what runs on every PR, benchmark exclusion, coverage
  threshold.

---

## Test plan

- [ ] `cd backend && npm test` — all existing tests pass; new checkout tests
  pass including rollback scenario.
- [ ] `cd routes-d && npm test` — all existing tests pass; new `redisClient`,
  `accountCache`, and `requestId` tests pass.
- [ ] Review `routes-d/docs/testing.md` for accuracy and completeness.


