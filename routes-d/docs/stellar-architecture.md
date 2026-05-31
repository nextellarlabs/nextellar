# Stellar Integration Architecture — routes-d

This document describes how the routes-d service integrates with the Stellar network
via Horizon (REST API) and Soroban (smart contract RPC).

---

## Overview

routes-d sits between Express route handlers and the Stellar network. Account
queries and ledger lookups go through the **Horizon REST API**; smart contract
invocations go through the **Soroban RPC**. Both clients are injected via factory
options so the routes stay testable without live network access.

```
                  Client Request
                       │
                       ▼
             Express Route Handler
                       │
          ┌────────────┴────────────┐
          │                         │
   [account / balance / ledger]  [contract invocation]
          │                         │
          ▼                         ▼
   lib/horizonClient.ts      lib/sorobanClient.ts
          │                         │
     HorizonClient             SorobanRpcLike
          │                         │
    ┌─────┴──────┐           simulate → sign
    │            │                   │
 primary      fallback           submit → poll
 Horizon      Horizon                 │
  URL          URL           PENDING / SUCCESS / FAILED
```

---

## Horizon Integration

Routes call `createHorizonClient(options)` from [`lib/horizonClient.ts`](../lib/horizonClient.ts)
and invoke `client.getJson(path)` to fetch account data, balances, and ledger state.

```typescript
import { createHorizonClient } from '../lib/horizonClient.js';

const horizon = createHorizonClient({ primaryUrl, fallbackUrl, fetcher });
const account = await horizon.getJson<AccountResponse>(`/accounts/${id}`);
```

The client is fully injectable: tests pass a custom `fetcher` function to avoid
real HTTP calls. Production builds use the default `fetch`-based fetcher.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Primary Horizon endpoint |
| `HORIZON_PRIMARY_URL` | same as `HORIZON_URL` | Alias for primary endpoint |
| `HORIZON_FALLBACK_URL` | _(none)_ | Optional fallback; omit to disable failover |
| `HORIZON_TIMEOUT_MS` | `5000` | Per-request timeout in milliseconds |

---

## Failover Strategy

When the primary Horizon endpoint fails (network error, non-2xx, or timeout),
`HorizonClient` promotes the fallback URL for that request and fires an
`onFailover` event:

```
primary URL fails
      │
      ▼
onFailover({ type: "horizon.failover", primaryUrl, fallbackUrl, reason, at })
      │
      ▼
retry same path against fallbackUrl
```

The `onFailover` callback defaults to `emitFailoverLog`, which writes a
structured JSON line to stdout:

```json
{
  "type": "horizon.failover",
  "primaryUrl": "https://horizon.stellar.org",
  "fallbackUrl": "https://horizon-backup.example.com",
  "reason": "timeout after 5000ms",
  "at": "2026-05-31T12:00:00.000Z"
}
```

Use `client.lastEndpointUsed()` to observe which endpoint served the last
request — useful for metrics and health dashboards.

---

## Soroban Integration

Smart contract calls use `invokeContract(rpc, opts)` from
[`lib/sorobanClient.ts`](../lib/sorobanClient.ts). The `rpc` parameter is a
`SorobanRpcLike` interface, which tests implement as a plain object mock.

```typescript
import { invokeContract, createDefaultSorobanClient } from '../lib/sorobanClient.js';

const { rpc, networkPassphrase } = createDefaultSorobanClient();
const outcome = await invokeContract(rpc, {
  contractId,
  method: 'transfer',
  args: [recipient, amount],
  signer: keypair,
  networkPassphrase,
});
```

### Invocation Pipeline

```
getAccount(signer.publicKey())
       │
       ▼
new Contract(contractId).call(method, ...args)
       │ operation
       ▼
new TransactionBuilder(account, { fee, networkPassphrase })
       .addOperation(operation).setTimeout(30).build()
       │ unsigned tx
       ▼
rpc.simulateTransaction(tx) ──► error? → SIMULATION_FAILED
       │ ok
       ▼
tx.sign(signer)
       │ signed tx
       ▼
rpc.sendTransaction(tx) ──► ERROR? → SUBMIT_FAILED
       │ PENDING + hash
       ▼
poll rpc.getTransaction(hash)
       ├── NOT_FOUND → sleep(50ms) → retry
       ├── SUCCESS   → { ok: true, resultXdr }
       └── FAILED    → { ok: false, code: 'REVERT' }
```

### Outcome Shape

`invokeContract` returns a discriminated union:

```typescript
// Success
{ ok: true;  contractId; method; resultXdr: string }

// Failure
{ ok: false; contractId; method; code: 'SIMULATION_FAILED' | 'SUBMIT_FAILED' | 'REVERT' | 'RPC_ERROR'; message: string }
```

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `SOROBAN_RPC_URL` | `https://soroban-rpc.stellar.org:443` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Testnet passphrase | Network identifier for transaction signing |

---

## Retry and Polling

The Soroban submit→poll loop is controlled by two injectable parameters:

| Parameter | Default | Description |
|---|---|---|
| `pollAttempts` | `10` | Maximum number of `getTransaction` calls |
| `sleep` | `setTimeout` resolver | Delay between polls (inject `() => Promise.resolve()` in tests) |

If the transaction does not reach SUCCESS or FAILED within `pollAttempts`,
`invokeContract` returns `{ ok: false, code: 'RPC_ERROR' }`.

---

## Cache Invalidation

Balance queries are cached by [`lib/balanceCache.ts`](../lib/balanceCache.ts)
with a TTL (default 30 seconds, configurable via `NEXTELLAR_BALANCE_CACHE_TTL_MS`).

```
GET /accounts/:id/balances
         │
         ▼
  BalanceCache.get(accountId)
         │
   ┌─────┴──────┐
   │ cached &   │ stale or missing
   │ !expired   │
   │            ▼
   │     HorizonClient.getJson(...)
   │            │
   │            ▼
   │     BalanceCache.set(accountId, balances)
   └──────────┬─┘
              ▼
        return balances
```

Callers bypass the cache with `forceRefresh: true` (used after outbound
payments to reflect the new balance immediately). An explicit `invalidate(accountId)`
hook is also available for post-payment cache eviction.

---

## Code References

| Concern | File |
|---|---|
| Horizon client factory | [`lib/horizonClient.ts`](../lib/horizonClient.ts) |
| Soroban invocation | [`lib/sorobanClient.ts`](../lib/sorobanClient.ts) |
| Balance cache | [`lib/balanceCache.ts`](../lib/balanceCache.ts) |
| Horizon health probe | [`routes/health.horizon.ts`](../routes/health.horizon.ts) |
| Soroban health probe | [`routes/health.soroban.ts`](../routes/health.soroban.ts) |
| Contract invoke route | [`routes/soroban.invoke.ts`](../routes/soroban.invoke.ts) |
| Stellar balance route | [`routes/stellar.balance.ts`](../routes/stellar.balance.ts) |
