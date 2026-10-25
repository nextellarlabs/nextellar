# Anchor Discovery & KYC Fields (SEP-1 / SEP-6 / SEP-9 / SEP-38)

This guide covers four client-side helpers shipped in the default template
under `src/lib`:

- **SEP-1** (`src/lib/sep1.ts`) — fetches and caches a domain's
  `stellar.toml` for anchor/asset discovery.
- **SEP-9** (`src/lib/sep9.ts`) — a typed, shared `Sep9Fields` interface plus
  a validation/builder helper for standard KYC/AML fields, used when
  building SEP-6/SEP-12/SEP-24 KYC payloads.
- **SEP-6** (`src/lib/sep6.ts`, `src/hooks/useSep6.ts`) — non-interactive
  deposit and withdrawal (on/off-ramp) against an anchor's
  `TRANSFER_SERVER`. See the [Hooks Reference](hooks.md#usesep6options).
- **SEP-38** (`src/lib/sep38.ts`, `src/hooks/useSep38Quote.ts`) — indicative
  and firm anchor quotes. See the [Hooks Reference](hooks.md#sep-hooks) for
  `useSep38Quote`'s full API.
- **SEP-24** (`src/lib/sep24.ts`, `src/hooks/useSep24Interactive.ts`,
  `src/components/Sep24InteractiveFrame.tsx`) — hosted interactive
  deposit/withdraw in a popup or iframe.

None of these implement an anchor server. They are pure client-side
building blocks for talking to one.

## SEP-1: `stellar.toml` discovery

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md

```typescript
import { fetchStellarToml, StellarTomlError } from '@/lib/sep1';

const toml = await fetchStellarToml('example.com');
console.log(toml.SIGNING_KEY, toml.ANCHOR_QUOTE_SERVER);
```

`fetchStellarToml(domain, options?)`:

- Accepts a **bare domain only** (e.g. `"example.com"`) — no scheme, path,
  port, credentials, or query string. Anything else throws
  `StellarTomlError` before a request is made.
- Delegates the actual HTTPS request and TOML parsing to the SDK's
  `StellarToml.Resolver` (`@stellar/stellar-sdk`), the same resolver
  `sep30.ts`/`sep45.ts` already use. Plain HTTP is rejected by default
  (`options.allowHttp` must be explicitly set — never enable it in
  production) and the resolver enforces `STELLAR_TOML_MAX_SIZE`.
- **Caching:** results are cached in-memory per normalized (lowercased,
  trimmed) domain for `options.cacheTtlMs` (default 5 minutes). Pass
  `cacheTtlMs: 0` to disable caching for a call, or `forceRefresh: true` to
  bypass a fresh cache entry. Concurrent calls for the same domain share a
  single in-flight request rather than issuing duplicate fetches.
- Throws `StellarTomlError` (never a raw fetch/parse error) on an invalid
  domain, network failure, non-2xx response, or malformed TOML.

## SEP-9: standard KYC fields

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0009.md

`Sep9Fields` (`@/lib/sep9`) is the single shared type for SEP-9 field names
in this codebase — build any SEP-6/SEP-12/SEP-24 KYC payload against it
instead of redeclaring field-name string literals ad hoc.

```typescript
import { buildSep9Payload, splitSep9Payload, type Sep9Fields } from '@/lib/sep9';

const fields: Sep9Fields = {
  first_name: 'Jane',
  last_name: 'Doe',
  email_address: 'jane@example.com',
  birth_date: '1990-05-12',
};

const payload = buildSep9Payload(fields); // drops undefined/empty values, validates shape
const { data, files } = splitSep9Payload(payload); // files: binary fields (photo_id_front, etc.)
```

- `validateSep9Fields(fields)` checks the *shape* of present values (ISO
  dates, email format, etc.) — it does not enforce which fields are
  required, since that's anchor- and transaction-specific (from the
  anchor's own SEP-12 `/info` response).
- `buildSep9Payload(fields)` validates, then drops `undefined`/`null`/
  empty-string values so a caller can pass raw form state directly.
  Throws if any present field fails validation.
- `splitSep9Payload(payload)` separates binary fields (`photo_id_front`,
  `proof_of_income`, etc. — see `SEP9_BINARY_FIELDS`) from string/number
  fields, for assembling a `multipart/form-data` SEP-12 request.

**Privacy:** KYC data is sensitive. Do not log `Sep9Fields` values, include
them in error messages, or commit real personal data as test fixtures —
this toolkit's own tests use synthetic values only.

## SEP-6: deposit and withdrawal

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0006.md

```typescript
import { discoverSep6TransferServer, fetchSep6Info, sep6Deposit } from '@/lib/sep6';

const transferServer = await discoverSep6TransferServer('anchor.example.com');
const info = await fetchSep6Info({ transferServer });

if (info.deposit.USDC?.enabled) {
  const result = await sep6Deposit({
    transferServer,
    authToken: sep10Jwt, // required when info.deposit.USDC.authenticationRequired
    assetCode: 'USDC',
    account: publicKey,
    amount: '100',
  });

  if (result.kind === 'customer_info_needed') {
    // Collect result.fields (SEP-9 names, see above) and submit them via SEP-12.
  }
}
```

- `discoverSep6TransferServer(domain)` resolves `TRANSFER_SERVER` from
  `stellar.toml` (via `fetchStellarToml`).
- `fetchSep6Info`, `sep6Deposit`, `sep6Withdraw` and `fetchSep6Transaction`
  wrap `GET /info`, `/deposit`, `/withdraw` and `/transaction`. All accept an
  optional SEP-10 `authToken` and a `fetchImpl` for testing.
- A 403 whose body is `non_interactive_customer_info_needed` or
  `customer_info_status` is returned as a `customer_info_needed` /
  `customer_info_status` result, because it is a normal step in the flow,
  not a failure. Any other non-2xx response throws `Sep6Error` with `status`
  and the parsed `body`.
- The interactive flow (SEP-24) is not covered here.

## SEP-38: anchor quotes

See the [Hooks Reference](hooks.md#sep-hooks) for `useSep38Quote`, and
`src/lib/sep38.ts` for the underlying `discoverSep38QuoteServer`,
`fetchSep38IndicativePrice`, and `fetchSep38FirmQuote` functions.

- **Indicative** prices (`GET /price`) are informational only — never treat
  `quote.kind === 'indicative'` as executable.
- **Firm** quotes (`POST /quote`) are binding until `quote.expiresAt`,
  which is taken as-is from the anchor's response.

## SEP-24: interactive deposit & withdraw

See the [Hooks Reference](hooks.md#sep-hooks) for `useSep24Interactive` and
`<Sep24InteractiveFrame>`.

- `discoverSep24TransferServer(homeDomain)` resolves `TRANSFER_SERVER_SEP0024`.
- `startSep24Interactive()` needs a SEP-10 JWT. Anchor URLs must be https;
  `javascript:`/`data:` URLs are rejected before anything is opened.
- `callback=postMessage` is appended to the URL. Messages are accepted only
  from the anchor URL's origin and only for the started transaction id.
- If the anchor never posts messages, polling `GET /transaction` still
  reaches the final status.

## See also

- [Hooks Reference](hooks.md) — full hook API reference, including
  `useSep6` and `useSep38Quote`.
- [Web Authentication & Payment Request URIs](web-auth-and-payments.md) —
  SEP-7 and SEP-45.
