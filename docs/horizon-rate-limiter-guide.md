# Horizon Rate Limiter: Configuration and Tuning

Nextellar's default template ships a client-side rate-limit guard,
`HorizonRateLimiter` (`src/lib/horizonRateLimiter.ts`), that protects
Horizon-polling hooks from hammering the server and tripping Horizon's own
`429 Too Many Requests` response. This guide explains its defaults, how the
guard behaves, and how to tune it for a high-traffic app.

## What it does

`HorizonRateLimiter` is a small client-side token-bucket-style guard:

- It tracks how many requests have gone out in a rolling time window.
- If a request would exceed the configured limit for that window, calls
  through `execute()` are rejected immediately (no request is sent) with a
  "wait N seconds" error, instead of letting the request go out and hit a
  real `429` from Horizon.
- If Horizon *does* return a `429` (e.g. because another client or tab is
  sharing the same IP), the limiter detects it, honors any `Retry-After`
  header Horizon sends, and enters a cooldown — all calls through `execute()`
  fail fast until the cooldown elapses, rather than retrying into more
  `429`s.

This is a **client-side guard**, not a server-side rate limiter — it exists
to keep a single browser tab/session from overwhelming Horizon, and to back
off cleanly once Horizon signals it's unhappy. It does not coordinate across
multiple tabs, devices, or users.

## Default configuration

```ts
export interface HorizonRateLimiterOptions {
  maxRequestsPerWindow?: number; // default: 30
  windowMs?: number;             // default: 10_000 (10s)
  defaultBackoffMs?: number;     // default: 5_000 (5s)
}
```

| Option                | Default   | Meaning                                                                                   |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `maxRequestsPerWindow`  | `30`      | Maximum number of requests allowed within any rolling `windowMs` window.                   |
| `windowMs`              | `10_000`  | Size of the rolling window (ms) used to count requests against `maxRequestsPerWindow`.     |
| `defaultBackoffMs`      | `5_000`   | Cooldown applied after a `429` with no `Retry-After` header, before requests are allowed again. |

A shared, pre-configured instance is exported for convenience:

```ts
import { globalHorizonRateLimiter } from '@/lib/horizonRateLimiter';
```

Using the shared instance means every call site that opts in shares the same
request budget — useful when several hooks/components poll Horizon
concurrently and you want one combined ceiling rather than per-hook limits.

## Tuning for your app

The right values depend on how many concurrent Horizon-polling consumers your
app runs and how aggressively Horizon's own infrastructure rate-limits your
IP/API key.

- **Lower-traffic apps / Horizon's public testnet endpoint**: the defaults
  (30 requests / 10s, 5s backoff) are a reasonable, conservative starting
  point and match Horizon's own general guidance for unauthenticated public
  endpoints.
- **High-traffic apps polling multiple accounts/streams**: raise
  `maxRequestsPerWindow` and/or widen `windowMs` only if you're running your
  own Horizon instance or have a provider-backed endpoint with a known, higher
  quota. Raising the limit against the shared public testnet/mainnet Horizon
  will not get you more throughput from Horizon itself — it only changes when
  *this guard* starts rejecting calls locally, so setting it too high just
  means you'll hit real `429`s instead of the friendlier client-side guard.
- **Flaky networks / aggressive upstream rate limiting**: increase
  `defaultBackoffMs` so a `429` with no `Retry-After` header results in a
  longer, safer cooldown before retrying.

To use a custom configuration instead of the shared instance, construct your
own limiter:

```ts
import { HorizonRateLimiter } from '@/lib/horizonRateLimiter';

const limiter = new HorizonRateLimiter({
  maxRequestsPerWindow: 60,
  windowMs: 15_000,
  defaultBackoffMs: 10_000,
});

async function pollAccount(accountId: string) {
  return limiter.execute(() => horizonServer.loadAccount(accountId));
}
```

## API reference

- `execute<T>(fn: () => Promise<T>): Promise<T>` — runs `fn` if under the
  rate limit and not in a cooldown; otherwise throws immediately without
  calling `fn`. If `fn` throws with a `429` status, records the cooldown
  automatically (using `Retry-After` when present).
- `isRateLimited(): boolean` — true if currently in a `429` cooldown or the
  rolling window is full.
- `getRemainingCooldownMs(): number` — ms remaining in an active `429`
  cooldown, or `0`.
- `record429(retryAfterSeconds?: number): void` — manually record a `429`
  (mainly useful if you're calling Horizon outside of `execute()` and want to
  feed the result back into the shared guard).
- `reset(): void` — clears the request window and any active cooldown.

## Related

- [Troubleshooting: Stellar network connectivity](./troubleshooting.md) —
  general connectivity and rate-limiting failure modes.
- [Troubleshooting: Soroban RPC rate limits](./troubleshooting-soroban.md) —
  the equivalent concern on the Soroban RPC side (not covered by this
  Horizon-specific guard).
