# routes-d

Scoped workspace for the routes-d backlog (see `Stellar Wave` issues).
Every file in this PR lives under this folder per the issue scope rule:
"Do not modify or add code outside the routes-d/ folder".

## Layout

```
routes-d/
  routes/    — Express routers (POST /soroban/invoke, plus future routes)
  lib/       — pure helpers, RPC clients, signing utilities
  tests/     — Jest tests, auto-picked-up by `tests/**/*.test.ts` testMatch
  docs/      — design notes
  middleware/, auth/ — reserved for future issues
```

## This PR

- `routes/soroban.invoke.ts` + `lib/sorobanClient.ts` — `POST /soroban/invoke`
  forwards a contract method call to Soroban RPC on the client's behalf
  (issue #272). The handler validates input, the lib runs the full
  simulate → sign → submit → poll pipeline. The lib accepts an injected
  `rpc` so tests stay offline.
- `tests/orders.load.test.ts` — load tests for orders endpoints
  (issue #307). Custom in-process runner (Promise.all batching) records
  p50/p95/p99 and fails when the configured budgets are exceeded.
- `tests/soroban.invoke.test.ts` — integration suite for the route, all
  paths (success, simulation reject, revert, submit error, validation).
