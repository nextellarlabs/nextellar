# Anchor Discovery & KYC Fields (SEP-1 / SEP-9 / SEP-38)

This guide covers three client-side helpers shipped in the default template
under `src/lib`:

- **SEP-1** (`src/lib/sep1.ts`) — fetches and caches a domain's
  `stellar.toml` for anchor/asset discovery.
- **SEP-9** (`src/lib/sep9.ts`) — a typed, shared `Sep9Fields` interface plus
  a validation/builder helper for standard KYC/AML fields, used when
  building SEP-6/SEP-12/SEP-24 KYC payloads.
- **SEP-38** (`src/lib/sep38.ts`, `src/hooks/useSep38Quote.ts`) — indicative
  and firm anchor quotes. See the [Hooks Reference](hooks.md#sep-hooks) for
  `useSep38Quote`'s full API.

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

## SEP-38: anchor quotes

See the [Hooks Reference](hooks.md#sep-hooks) for `useSep38Quote`, and
`src/lib/sep38.ts` for the underlying `discoverSep38QuoteServer`,
`fetchSep38IndicativePrice`, and `fetchSep38FirmQuote` functions.

- **Indicative** prices (`GET /price`) are informational only — never treat
  `quote.kind === 'indicative'` as executable.
- **Firm** quotes (`POST /quote`) are binding until `quote.expiresAt`,
  which is taken as-is from the anchor's response.

## See also

- [Hooks Reference](hooks.md) — full hook API reference, including
  `useSep38Quote`.
- [Web Authentication & Payment Request URIs](web-auth-and-payments.md) —
  SEP-7 and SEP-45.
