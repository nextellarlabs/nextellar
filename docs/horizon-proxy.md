# Horizon Proxy: Keep Hosted Horizon API Keys Server-Side

Hosted Horizon providers (and some RPC gateways) require an API key. Anything
prefixed with `NEXT_PUBLIC_` is inlined into the browser bundle, so a key in
`NEXT_PUBLIC_HORIZON_URL` is visible to every visitor. The default template
ships a same-origin proxy that keeps the key on the server.

The proxy lives at:

```
src/app/api/horizon/[...path]/route.ts   # request handler
src/lib/horizonProxy.ts                  # allowlist + client opt-in helpers
```

It is included in the `default` template and therefore in `full` (which is
composed from `default` plus the `full` overlay).

## Setup

1. Point the server-only variables at your provider:

   ```bash
   NEXT_PUBLIC_HORIZON_PROXY=true
   HORIZON_PROXY_URL=https://horizon.example-provider.com
   HORIZON_PROXY_API_KEY=your-provider-key
   ```

2. Leave `NEXT_PUBLIC_HORIZON_URL` as the public fallback (or remove it). It is
   only used by the proxy when `HORIZON_PROXY_URL` is unset, and by code paths
   that still talk to Horizon directly.

3. Restart the dev server. Client hooks listed below now call
   `/api/horizon/...` and the route injects the key server-side.

### Environment variables

| Variable                       | Default                                                               | Purpose                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_HORIZON_PROXY`    | unset (disabled)                                                      | Set to `1`, `true`, `yes` or `on` to make the shipped client hooks use the proxy.                          |
| `HORIZON_PROXY_URL`            | `NEXT_PUBLIC_HORIZON_URL`, then `https://horizon-testnet.stellar.org` | Server-only upstream base URL. May include a path prefix.                                                  |
| `HORIZON_PROXY_API_KEY`        | unset                                                                 | Server-only provider key. Never prefix this with `NEXT_PUBLIC_`.                                           |
| `HORIZON_PROXY_API_KEY_HEADER` | `Authorization`                                                       | Header that carries the key. `Authorization` is sent as `Bearer <key>`; any other header is sent verbatim. |
| `HORIZON_PROXY_CACHE_TTL_MS`   | `3000`                                                                | How long a successful GET is cached in memory. `0` disables caching.                                       |
| `HORIZON_PROXY_TIMEOUT_MS`     | `10000`                                                               | Upstream request timeout. `0` disables the timeout.                                                        |

## What the proxy does

- **Allowlist only.** Only read-only Horizon paths are forwarded: accounts and
  their sub-resources, ledgers, transactions, operations, payments, effects,
  `fee_stats`, `network`, `assets`, `order_book`, `trade_aggregations`,
  claimable balances, liquidity pools, and strict-send/strict-receive path
  finding. Anything else returns `400` without contacting the provider, which
  keeps a server-side key from being spent on arbitrary endpoints.
- **GET only.** `POST` and other methods return `405`; transaction submission
  still goes through the wallet/provider path in the app.
- **Key injection.** The provider key is read from the server environment and
  set on the outgoing request. Client headers (including any client-supplied
  `Authorization`) are never forwarded.
- **Short-lived cache.** Successful `GET` responses are cached in memory for
  `HORIZON_PROXY_CACHE_TTL_MS`, keyed by path + query string. Cached responses
  carry `x-nextellar-proxy-cache: HIT`; misses carry `MISS`.
- **Rate-limit headers.** `Retry-After` and `X-Ratelimit-*` headers are passed
  through so the default template's `HorizonRateLimiter` can back off on a
  provider `429`. Error responses and `429`s are never cached.

## Which hooks opt in

The following default-template hooks call `resolveHorizonUrl()` and therefore
switch to the proxy automatically when `NEXT_PUBLIC_HORIZON_PROXY=true`:

- `useStellarBalances`
- `useTransactionHistory`
- `useOfferBook`

Writing hooks (`useStellarPayment`, `useTrustlines`) and `WalletProvider` keep
using the direct Horizon URL because the proxy is read-only.

Horizon SSE streaming (`useHorizonStreaming`) is not proxied: the route buffers
responses and does not implement SSE. With the flag on, `useStellarBalances`
disables streaming and keeps using polling.

To proxy a custom read, call `resolveHorizonUrl()` yourself:

```ts
import { resolveHorizonUrl } from "@/lib/horizonProxy";

const horizonUrl = resolveHorizonUrl(process.env.NEXT_PUBLIC_HORIZON_URL!);
const res = await fetch(`${horizonUrl}/accounts/${address}`);
```

## Security notes

- The key is read at request time from `HORIZON_PROXY_API_KEY`, so it is never
  bundled into client JavaScript.
- The allowlist is an explicit list of regular expressions, not a prefix
  check. Path segments containing traversal characters, encoded slashes, or an
  unknown suffix are rejected.
- The route does not forward client cookies or arbitrary headers upstream.
- Cross-instance cache coherency is best-effort; the TTL is deliberately short.
