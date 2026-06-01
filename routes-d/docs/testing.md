# routes-d Testing Guide

This document describes how to write and run tests for the `routes-d` package.  
All test files live under `routes-d/tests/` and are executed with **Jest** via
the `ts-jest` ESM preset.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Test Types](#2-test-types)
   - [Unit Tests](#21-unit-tests)
   - [Integration Tests](#22-integration-tests)
   - [Snapshot Tests](#23-snapshot-tests)
   - [Fuzz Tests](#24-fuzz-tests)
   - [Load / Benchmark Tests](#25-load--benchmark-tests)
3. [Fixture Conventions](#3-fixture-conventions)
4. [Flaky Tests](#4-flaky-tests)
5. [CI Integration](#5-ci-integration)

---

## 1. Quick Start

```bash
# From the repo root
cd routes-d

# Install dependencies
npm install

# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run with coverage
npx jest --coverage
```

Jest is configured in `routes-d/jest.config.js`.  All `*.test.ts` files under
`routes-d/tests/` are automatically discovered.

---

## 2. Test Types

### 2.1 Unit Tests

Unit tests exercise a **single module in isolation**.  All external dependencies
(Redis, database, HTTP clients) are replaced with in-process stubs or Jest mocks.

**File convention:** `tests/<module-name>.test.ts`  
**Naming convention:** `<module>.unit.test.ts` when a file contains only unit
tests and a peer integration file exists (e.g. `auditLog.unit.test.ts`).

**Guidelines:**

- Import only the module under test; mock everything else with `jest.fn()` or
  the built-in stubs provided in `routes-d/lib/` (e.g. `InMemoryRedisClient`).
- Keep each `it` block focused on one behaviour and prefer descriptive names
  that read like a sentence: _"returns null for a key that has never been set"_.
- Avoid real I/O, timers (`setTimeout`), and network calls.  Use
  `jest.useFakeTimers()` / `jest.spyOn(Date, 'now')` to control time.

**Example:**

```ts
import { AccountCache } from "../lib/accountCache.js";
import { InMemoryRedisClient } from "../lib/redisClient.js";

describe("AccountCache – cache miss", () => {
  it("calls the fetcher and stores the result", async () => {
    const client = new InMemoryRedisClient();
    const cache = new AccountCache({ client });
    const fetcher = jest.fn().mockResolvedValue({ accountId: "a1", /* … */ });

    const { fromCache } = await cache.getProfile("a1", fetcher);

    expect(fromCache).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

---

### 2.2 Integration Tests

Integration tests wire **multiple real modules together** (e.g. an Express app
plus middleware plus a route handler) and exercise them over HTTP using
[supertest](https://github.com/ladjs/supertest).

**File convention:** `tests/<feature>.integration.test.ts`

**Guidelines:**

- Construct the full Express app with `express()`, mount all relevant
  middleware, and call `request(app).get(…)`.
- Use the in-process stubs (e.g. `InMemoryRedisClient`) instead of a real Redis
  or database — integration tests should be runnable without external services.
- Each `describe` block should reset shared state in `beforeEach` / `afterEach`
  to avoid test-order dependencies.
- Assert on HTTP status codes, response bodies, and response headers — not on
  internal state.

**Example:**

```ts
import express from "express";
import request from "supertest";
import { requestId } from "../middleware/requestId.js";

describe("requestId integration", () => {
  it("echoes X-Request-Id back", async () => {
    const app = express();
    app.use(requestId);
    app.get("/", (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/").set("X-Request-Id", "abc123");
    expect(res.headers["x-request-id"]).toBe("abc123");
  });
});
```

---

### 2.3 Snapshot Tests

Snapshot tests are appropriate for **stable, structured output** that is
expensive to assert field-by-field — for example serialised Prometheus metrics
strings or large JSON fixtures.

**File convention:** `tests/<module>.snapshot.test.ts`  
Snapshots are stored in `tests/__snapshots__/`.

**Guidelines:**

- Write snapshots for output that is deliberately stable.  Do **not** snapshot
  values that include timestamps, random IDs, or other volatile data.
- Update snapshots intentionally with `npx jest --updateSnapshot` and review
  the diff in the PR.
- Keep snapshot files committed to version control so regressions are caught in
  CI.

**Example:**

```ts
import { renderDbPoolMetrics } from "../lib/db.js";

it("renders Prometheus metrics string", () => {
  // inject deterministic metrics
  expect(renderDbPoolMetrics()).toMatchSnapshot();
});
```

---

### 2.4 Fuzz Tests

Fuzz tests feed **random or boundary-value inputs** to a function to uncover
crashes and unexpected behaviour.

**File convention:** `tests/<module>.fuzz.test.ts`

**Guidelines:**

- Generate inputs with `fast-check` or simple `Array.from` loops.
- Focus on parsing, validation, and serialisation code where malformed input is
  plausible (e.g. `sanitize.ts`, `memo.ts`, `amount.ts`).
- Keep fuzz iterations low (≤ 1 000) so CI stays fast; use `fast-check`'s
  `fc.assert` with `{ numRuns: 500 }`.
- A fuzz test must **not** make network calls or write to disk.

**Example:**

```ts
import fc from "fast-check";
import { parseMemo } from "../lib/memo.js";

it("never throws on arbitrary string input", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      expect(() => parseMemo(s)).not.toThrow();
    }),
    { numRuns: 500 },
  );
});
```

---

### 2.5 Load / Benchmark Tests

Load tests measure **throughput and latency** under sustained concurrency.  They
are informational — they do not have pass/fail thresholds in CI — and are kept
in `tests/bench/`.

**File convention:** `tests/bench/<scenario>-profile.ts`  
These files are executed manually (not by the default `npm test` run).

**Guidelines:**

- Use the `_recorder.ts` helper in `tests/bench/` to collect timing samples.
- Document the hardware and Node version used when recording a baseline so
  future comparisons are meaningful.
- Benchmark files should import only in-process stubs and avoid real I/O.

**Running a benchmark manually:**

```bash
npx ts-node --esm routes-d/tests/bench/auth-hot-path-profile.ts
```

---

## 3. Fixture Conventions

Static JSON fixtures live in `tests/fixtures/` and are imported directly with
`import … from "…/fixtures/horizon.accounts.json" assert { type: "json" }`.

**Rules:**

| Rule | Detail |
|------|--------|
| One concern per file | `horizon.accounts.json` contains only account data; payment data goes in `horizon.payments.json`. |
| No real credentials | Replace real account IDs, keys, and tokens with obviously fake values (`GAAAAAAAAA…`, `test-key`, etc.). |
| Keep fixtures minimal | Include only the fields your tests actually assert on. Large unused blobs slow parsing and obscure intent. |
| Refresh with care | Update a fixture only when the upstream API contract changes; document the change in the commit message. |

Fixtures for volatile data (e.g. a Horizon response that rotates ledger
sequence numbers) should be regenerated via the scripts in
`docs/refresh-horizon-fixtures.md`.

---

## 4. Flaky Tests

A test is **flaky** if it passes sometimes and fails others without a code
change.  Common causes in routes-d:

- Time-dependent assertions (use `jest.useFakeTimers()` or inject a `now` clock)
- Race conditions in async code (await all promises; avoid `setTimeout` in tests)
- Shared mutable state between tests (reset in `beforeEach` / `afterEach`)
- External network calls (mock or stub all I/O)

### Marking a flaky test

Add a `// FLAKY:` comment on the `it` line with a brief reason and a link to
the tracking issue, then use `it.skip` until fixed:

```ts
// FLAKY: #412 — depends on real-clock timing; needs fake timer
it.skip("retries after 500 ms", async () => { … });
```

### Triaging a flaky test

1. Run the test 10× in isolation: `npx jest --testNamePattern="<name>" --runInBand`
2. Check for shared state: grep for module-level `let`/`const` that are mutated.
3. Check for unresolved promises: ensure every `await` is present.
4. If you cannot fix it immediately, open a GitHub issue tagged `flaky-test` and
   link it in the `// FLAKY:` comment.

---

## 5. CI Integration

The default `npm test` command runs **all unit and integration tests** and must
pass on every PR.

Benchmark (`tests/bench/`) and manual end-to-end scripts are excluded from CI
via the `testMatch` pattern in `jest.config.js` (`**/tests/**/*.test.ts`).

Coverage is collected from `lib/`, `routes/`, and `middleware/`.  The CI
pipeline fails if coverage drops below the project threshold (configured in
`jest.config.js` under `coverageThreshold`).
