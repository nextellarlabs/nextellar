# Web Authentication & Payment Request URIs (SEP-7 / SEP-10 / SEP-45)

This guide covers the web authentication and payment URI building blocks shipped
in the default template:

- **SEP-10** (`src/app/api/sep10/route.ts`) — reference **server-side** Next.js
  App Router endpoint for classic Stellar Web Authentication (issuing and
  verifying challenge transactions, disabled by default until configured via
  environment variables).
- **SEP-45** (`src/lib/sep45.ts`) — client-side Stellar Web Authentication for
  **contract accounts** (`C...`), the Soroban analog of SEP-10.
- **SEP-7** (`src/lib/sep7.ts`) — the `web+stellar:` URI scheme for
  requesting a payment or transaction signature, e.g. via QR code or deep
  link.

## SEP-10: Server-Side Web Authentication (`app/api/sep10/route.ts`)

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md

The default template includes a reference SEP-10 server route at
`src/app/api/sep10/route.ts` implementing both halves of the protocol:

- **`GET /api/sep10?account=<G...|M...>[&memo=<uint64>][&home_domain=<domain>]`** —
  validates the requested account, builds a SEP-10 challenge transaction with
  `Utils.buildChallengeTx`, signs it with the server's signing key, and returns
  `{ transaction, network_passphrase }`.
- **`POST /api/sep10`** — accepts `application/json` (`{ "transaction": "..." }`)
  or `application/x-www-form-urlencoded` (`transaction=...`), validates the
  challenge structure and server signature with `Utils.readChallengeTx`, verifies
  client signatures against on-chain Horizon signers/thresholds (or the master
  key when the account is not yet funded on-chain), and returns `{ token }`
  (an HS256-signed JWT containing `iss`, `sub`, `iat`, `exp`, and `jti`).

### Setup

The route is **disabled by default** and responds with `503 Service Unavailable`
until all required server-side environment variables are set:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SEP10_SIGNING_SEED` | Yes | — | Stellar secret seed (`S...`) matching `SIGNING_KEY` in your `stellar.toml`. |
| `SEP10_HOME_DOMAIN` | Yes | — | Primary home domain (e.g. `example.com`). |
| `SEP10_JWT_SECRET` | Yes | — | High-entropy secret (at least 32 characters) used to sign HS256 JWTs. |
| `SEP10_WEB_AUTH_DOMAIN` | No | `SEP10_HOME_DOMAIN` | Domain hosting the `/api/sep10` endpoint (e.g. `auth.example.com`). |
| `SEP10_NETWORK_PASSPHRASE` | No | Derived from `NEXT_PUBLIC_NETWORK` | Stellar network passphrase (`Networks.TESTNET` or `Networks.PUBLIC`). |
| `SEP10_HORIZON_URL` | No | `NEXT_PUBLIC_HORIZON_URL` or public Horizon | Horizon server used to fetch on-chain account signers and thresholds. |
| `SEP10_CHALLENGE_TTL_SECONDS` | No | `300` | Challenge transaction validity window in seconds. |
| `SEP10_JWT_TTL_SECONDS` | No | `86400` | Issued JWT lifetime in seconds. |

To expose the endpoint to SEP-10 clients, publish the corresponding public key
and endpoint URL in `https://<home-domain>/.well-known/stellar.toml`:

```toml
SIGNING_KEY="G..."
WEB_AUTH_ENDPOINT="https://auth.example.com/api/sep10"
```

### Security caveats

- **Server-only secrets:** Never prefix `SEP10_SIGNING_SEED` or
  `SEP10_JWT_SECRET` with `NEXT_PUBLIC_`, never commit `.env.local`, and never
  pass secrets via query parameters or request bodies. All secrets are read
  strictly from `process.env`.
- **Dedicated unfunded signing key:** Use a dedicated Stellar keypair solely for
  SEP-10 signing. Do not reuse an operational/distribution account key and do
  not hold funds on the signing account.
- **HTTPS required in production:** Always terminate TLS in front of `/api/sep10`
  so signed challenges and bearer JWTs cannot be intercepted in transit.
- **Replay protection & rate limiting:** Each issued JWT includes `jti` set to
  the challenge transaction hash. Because this reference route is stateless,
  production deployments should add rate limiting and record consumed `jti`
  values (e.g. in Redis) for the challenge TTL to prevent challenge replay.
- **Key management & rotation:** For production anchors, consider backing the
  signing key with a KMS/HSM and rotating `SEP10_JWT_SECRET` and
  `SEP10_SIGNING_SEED` periodically (see `docs/secret-rotation.md`).

## SEP-45: Web Authentication for Contract Accounts

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md

SEP-45 replaces SEP-10's dummy-transaction signature with a
`SorobanAuthorizationEntry` invoking a well-known `web_auth_verify` function
on a `WEB_AUTH_CONTRACT_ID` contract. The client-side flow has five steps,
each a function exported from `src/lib/sep45.ts`:

| Step | Function                  | Purpose                                                                 |
| ---- | -------------------------- | ------------------------------------------------------------------------ |
| 1    | `discoverSep45Endpoint`    | Resolves `stellar.toml` for the auth endpoint, contract ID, and server signing key. |
| 2    | `fetchSep45Challenge`      | GETs the challenge (signed authorization entries) from the server.      |
| 3    | `verifySep45Challenge`     | Validates the challenge **before signing anything** (structural/args checks SEP-45 requires of a client). |
| 4    | `signSep45ClientEntry`     | Signs the client's own entry with `authorizeEntry`.                     |
| 5    | `submitSep45Token`         | POSTs the signed entries back and returns the session JWT.              |

### Example

```typescript
import {
  discoverSep45Endpoint,
  fetchSep45Challenge,
  verifySep45Challenge,
  signSep45ClientEntry,
  submitSep45Token,
} from "@/lib/sep45";

const clientAccount = "CABC..."; // the contract account authenticating
const homeDomain = "example.com";

const { endpoint, contractId, serverSigningKey } = await discoverSep45Endpoint(homeDomain);

const challenge = await fetchSep45Challenge({ endpoint, account: clientAccount, homeDomain });

const { web_auth_domain } = verifySep45Challenge(challenge, {
  contractId,
  serverSigningKey,
  homeDomain,
  webAuthDomain: new URL(endpoint).hostname,
  account: clientAccount,
});

const signedEntries = await signSep45ClientEntry(challenge, {
  clientAccount,
  signer: mySigningCallback, // or a dev-only Keypair — never a raw secret in production
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  validUntilLedgerSeq: currentLedger + 100,
});

const token = await submitSep45Token({ endpoint, entries: signedEntries });
```

### Security notes

- `verifySep45Challenge` performs every check that is a pure function of the
  challenge payload (no sub-invocations, matching `contract_address`,
  matching `web_auth_verify` args across entries, a Server Account entry
  with a signature, a Client Account entry present). It does **not** verify
  the Server Account's cryptographic signature — SEP-45 requires simulating
  the transaction against the network for that, which needs a configured RPC
  client and is left to the caller.
- Passing a raw `Keypair` (built from a secret key) to `signSep45ClientEntry`
  is for **development only**. In production, pass a `SigningCallback` that
  delegates to a wallet adapter so the secret key never enters application
  memory.

### XDR encoding detail

The server exchanges authorization entries as a single base64 string: an XDR
variable-length array of `SorobanAuthorizationEntry` (a `uint32` count
followed by each entry's own encoding). Not every version of
`@stellar/stellar-sdk` exposes a ready-made array codec for this type on its
`xdr` namespace, so `sep45.ts` encodes/decodes it directly using
`@stellar/js-xdr`'s reader/writer (already a transitive dependency of the
SDK, declared as a direct dependency here so the version is pinned). This is
an implementation detail — callers only ever see decoded
`xdr.SorobanAuthorizationEntry[]` arrays via `Sep45Challenge.entries`.

## SEP-7: `web+stellar:` Payment Request URIs

https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md

`src/lib/sep7.ts` implements the `pay` operation only — encoding a payment
*request* (destination, optional amount/asset/memo/message) into a
`web+stellar:pay?...` URI suitable for a QR code or deep link. The `tx`
operation (submitting an arbitrary pre-built transaction XDR) is out of
scope.

| Function            | Purpose                                                        |
| -------------------- | ---------------------------------------------------------------- |
| `buildSep7PayUri`     | Builds a `web+stellar:pay` URI from structured parameters.      |
| `parseSep7PayUri`     | Parses a `web+stellar:pay` URI back into structured parameters. |
| `isSep7Uri`           | Quick check for whether a string looks like any `web+stellar:` URI. |

```typescript
import { buildSep7PayUri, parseSep7PayUri } from "@/lib/sep7";

buildSep7PayUri({ destination: "GABC..." });
// "web+stellar:pay?destination=GABC..." — bare address, no amount

buildSep7PayUri({
  destination: "GABC...",
  amount: "25",
  asset: { code: "USDC", issuer: "GISSUER..." },
  msg: "Invoice #42",
});
// "web+stellar:pay?destination=GABC...&amount=25&asset_code=USDC&asset_issuer=GISSUER...&msg=Invoice%20%2342"

parseSep7PayUri("web+stellar:pay?destination=GABC...&amount=10");
// { operation: 'pay', destination: 'GABC...', amount: '10' }
```

### `ReceiveForm` integration

`ReceiveForm` (see [Components Reference](./components-reference.md)) accepts
optional `amount`, `asset`, `memo`, and `message` props. When `amount` is
set, the QR code and copy button encode a SEP-7 payment-request URI via
`buildSep7PayUri` instead of the bare address — the address text itself is
always shown in plain form for readability. If building the URI throws (e.g.
an incomplete `asset`), the component logs the error and falls back to the
bare-address QR code rather than crashing.

```tsx
// Bare address (default)
<ReceiveForm />

// SEP-7 payment request for 25 USDC
<ReceiveForm amount="25" asset={{ code: 'USDC', issuer: 'GISSUER...' }} message="Invoice #42" />
```

## See also

- [Components Reference](./components-reference.md)
- [React Hooks Reference](./hooks.md)
