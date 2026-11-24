# Anchor Discovery, Authentication & KYC (SEP-1 / SEP-10 / SEP-12 / SEP-6 / SEP-9 / SEP-38)

This guide covers the client-side helpers shipped in the default template
under `src/lib`:

- **SEP-1** (`src/lib/sep1.ts`) — fetches and caches a domain's
  `stellar.toml` for anchor/asset discovery.
- **SEP-10** — the Stellar Web Authentication challenge/response flow for
  classic accounts (`G…`/`M…`) that produces the JWT consumed by SEP-6,
  SEP-12, SEP-24, and SEP-38.
- **SEP-12** — the KYC/AML endpoint anchors require before they process a
  transfer; payload construction uses the SEP-9 helpers below.
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

## SEP-10: Web Authentication for classic accounts

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md

SEP-10 is the authentication layer that sits in front of every authenticated
anchor endpoint — SEP-6, SEP-12, SEP-24, and SEP-38 all accept a JWT issued
by a successful SEP-10 challenge/response cycle. Without a valid JWT, any of
those endpoints that set `authenticationRequired: true` will return 403.

The toolkit does not ship a built-in SEP-10 helper for classic accounts
(`G…`/`M…`) — anchors that implement SEP-10 for Soroban contract accounts
(`C…`) are covered separately in
[`sep45.ts`](web-auth-and-payments.md#sep-45-web-authentication-for-contract-accounts).
For classic accounts you have two options: use the Stellar SDK's built-in
`Utils.buildChallengeTx` / `Utils.readChallengeTx` / `Utils.verifyChallengeTxSigners`
utilities (server-side), or handle the challenge/submit cycle yourself
client-side as shown below.

### The SEP-10 flow

```
Client                              Anchor
  │                                   │
  │  GET /auth?account=G…             │
  │──────────────────────────────────>│
  │  { transaction: "<XDR>" }         │
  │<──────────────────────────────────│
  │                                   │
  │  (verify challenge, sign with wallet)
  │                                   │
  │  POST /auth  { transaction: "<signed XDR>" }
  │──────────────────────────────────>│
  │  { token: "<JWT>" }               │
  │<──────────────────────────────────│
```

1. **Discover** the auth endpoint from `stellar.toml`:

   ```typescript
   import { fetchStellarToml } from '@/lib/sep1';

   const toml = await fetchStellarToml('anchor.example.com');
   const webAuthEndpoint = toml.WEB_AUTH_ENDPOINT as string; // e.g. "https://anchor.example.com/auth"
   const serverSigningKey = toml.SIGNING_KEY as string;      // the anchor's G… key
   ```

2. **Fetch the challenge** — a transaction the anchor has signed with its `SIGNING_KEY`:

   ```typescript
   const res = await fetch(`${webAuthEndpoint}?account=${publicKey}`);
   const { transaction, network_passphrase } = await res.json() as {
     transaction: string;
     network_passphrase: string;
   };
   ```

3. **Verify the challenge** before signing. At minimum, check:
   - `network_passphrase` matches the network you expect.
   - The transaction has a single Manage Data operation whose key starts with
     the anchor's home domain and whose source account is `publicKey`.
   - The transaction is signed by `serverSigningKey`.
   - The transaction's time bounds are present and have not expired.

   The SDK's `Utils.readChallengeTx` performs these checks server-side. On
   the client, you should at least verify the network passphrase before signing.

4. **Sign the challenge** via a wallet adapter (never a raw secret key in production):

   ```typescript
   import { useSepXdrSigner } from '@/hooks/useSepXdrSigner';

   const { signXdr } = useSepXdrSigner({ networkPassphrase: network_passphrase });
   const signedXdr = await signXdr(transaction);
   ```

   `useSepXdrSigner` delegates to Freighter. For other wallets, call your
   wallet kit's `signTransaction` equivalent.

5. **Submit the signed challenge** for a JWT:

   ```typescript
   const tokenRes = await fetch(webAuthEndpoint, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ transaction: signedXdr }),
   });
   const { token } = await tokenRes.json() as { token: string };
   // Store `token` in React state or a secure session store.
   // Pass it as `authToken` to useSep6, useSep24Interactive, useSep38Quote, etc.
   ```

### Security notes

- **Sign through a wallet adapter, not a raw keypair.** A raw `Keypair`
  (from `Keypair.fromSecret(...)`) loads the private key into application
  memory and must never appear in production code. Use `useSepXdrSigner` or
  an equivalent wallet-kit method so the secret stays in the extension.
- **Verify the network passphrase.** A challenge for `Test SDF Network ; September 2015`
  must not be signed on `Public Global Stellar Network ; September 2015` and
  vice versa. Reject any mismatch before calling `signXdr`.
- **Verify the server's signing key.** The challenge transaction must be
  signed by the key listed as `SIGNING_KEY` in the anchor's `stellar.toml`.
  Signing an unsigned or adversarially-constructed challenge can allow an
  anchor impersonator to authenticate as your user at a third-party anchor.
- **Check time bounds.** SEP-10 challenges have a 15-minute window. If the
  system clock is skewed far enough, the anchor will reject the signed XDR.
  Warn the user rather than silently failing.
- **Treat the JWT as a session secret.** Store it in memory (React state),
  not `localStorage` or a cookie accessible to third-party scripts. Clear it
  on disconnect.
- **JWTs expire.** Most anchors issue tokens valid for 24 hours. When a
  request returns 401, discard the token and re-run the SEP-10 flow. Do not
  retry with an expired token.
- **JWTs are account-scoped.** A token issued for `GABC…` is only accepted
  for endpoints where the requesting account matches the token's `sub` claim.
  Using a token from one account for another account's KYC or transfer
  request will be rejected.

---

## SEP-12: KYC via anchor's customer endpoint

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md

SEP-12 is the protocol anchors use to collect and store KYC information.
When a SEP-6 deposit or withdrawal returns `kind: 'customer_info_needed'`,
the anchor is telling you which SEP-9 fields it needs before it will continue.
You collect those fields from the user and submit them to the anchor's
`KYC_SERVER` via `PUT /customer`.

### Discovery

```typescript
const toml = await fetchStellarToml('anchor.example.com');
const kycServer = toml.KYC_SERVER as string; // e.g. "https://anchor.example.com/kyc"
```

### Submitting KYC data

SEP-12 `PUT /customer` accepts `multipart/form-data`. Use
`buildSep9Payload` to validate and prune the user's form state, then
`splitSep9Payload` to separate binary uploads from string fields:

```typescript
import { buildSep9Payload, splitSep9Payload } from '@/lib/sep9';

// `formValues` is raw state from a KYC form component.
const payload = buildSep9Payload(formValues); // validates and drops empty fields
const { data, files } = splitSep9Payload(payload);

const body = new FormData();
body.append('account', publicKey);           // required: identifies the customer record
body.append('jwt', authToken);               // some anchors want this in the form body
for (const [key, value] of Object.entries(data)) {
  body.append(key, String(value));
}
for (const [key, blob] of Object.entries(files)) {
  body.append(key, blob as Blob, `${key}.jpg`);
}

const res = await fetch(`${kycServer}/customer`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${authToken}` },
  body,
});
```

A `202` response means the anchor received the data and KYC review is
pending. A `200` means the customer record was accepted. Some anchors also
return a `customer_id` you can pass in subsequent SEP-6/SEP-24 requests.

### KYC status polling

After submitting, the anchor may take time to review. Poll
`GET /customer?account=<publicKey>` with the same JWT until `status` is
`ACCEPTED`:

```typescript
const statusRes = await fetch(`${kycServer}/customer?account=${publicKey}`, {
  headers: { Authorization: `Bearer ${authToken}` },
});
const { status, fields } = await statusRes.json() as {
  status: 'NEEDS_INFO' | 'PROCESSING' | 'ACCEPTED' | 'REJECTED';
  fields?: Record<string, { status: string; description: string }>;
};
```

- `NEEDS_INFO` — the anchor needs more fields; `fields` lists what is missing.
- `PROCESSING` — the anchor is reviewing the submission.
- `ACCEPTED` — KYC passed; you can now retry the SEP-6/SEP-24 transfer.
- `REJECTED` — KYC was denied; `fields` may explain why.

### Connecting SEP-10 auth to SEP-12 and SEP-6

The typical flow for a first-time deposit looks like this:

```
1. fetchStellarToml(homeDomain)
      → WEB_AUTH_ENDPOINT, KYC_SERVER, TRANSFER_SERVER, SIGNING_KEY

2. SEP-10 challenge/sign/submit (see above)
      → authToken (JWT)

3. useSep6.deposit({ assetCode: 'USDC', account: publicKey, authToken })
      → { kind: 'customer_info_needed', fields: ['first_name', 'last_name', 'birth_date', …] }

4. Collect those SEP-9 fields from the user.

5. buildSep9Payload + splitSep9Payload → PUT /customer (SEP-12)
      → 202 Accepted (pending review)

6. Poll GET /customer until status === 'ACCEPTED'.

7. Retry useSep6.deposit(…)
      → { kind: 'deposit', how: '…', id: '…' }
```

### Security notes

- **Never log KYC data.** Do not include `Sep9Fields` values in error
  messages, analytics events, or console output. Use synthetic values in
  tests — this toolkit's own tests do so.
- **Binary fields are sensitive.** `photo_id_front`, `photo_id_back`, and
  similar fields are identity documents. Send them directly to the anchor's
  `KYC_SERVER` over HTTPS; never store them client-side beyond the form
  interaction.
- **The JWT must match the customer account.** `PUT /customer` and
  `GET /customer` are authenticated with the same JWT from SEP-10. Using a
  token for the wrong account will result in a 403 or silently create a
  record for the wrong user.
- **`customer_info_status` is not a failure.** A `kind: 'customer_info_status'`
  result from SEP-6 means KYC is under review or was denied — handle it in
  the UI rather than surfacing it as an error. See `useSep6`'s
  `needsCustomerInfo` flag.

---

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
  SEP-7 and SEP-45 (Soroban contract-account auth, the `C…` analog of
  SEP-10 for classic accounts).
