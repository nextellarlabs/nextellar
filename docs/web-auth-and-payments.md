# Web Authentication & Payment Request URIs (SEP-7 / SEP-45)

This guide covers two client-side helpers shipped in the default template
under `src/lib`:

- **SEP-45** (`src/lib/sep45.ts`) — Stellar Web Authentication for **contract
  accounts** (`C...`), the Soroban analog of SEP-10.
- **SEP-7** (`src/lib/sep7.ts`) — the `web+stellar:` URI scheme for
  requesting a payment or transaction signature, e.g. via QR code or deep
  link.

Neither helper implements a server, an on-chain contract, or network
submission — both are pure client-side building blocks: SEP-45 drives a
challenge/sign/submit flow against a server you point it at, and SEP-7 only
builds/parses URI strings.

There is currently no separate SEP-10 (classic account) helper or guide in
this toolkit; SEP-45 is documented here as the Soroban/contract-account
counterpart of that flow, following the same client responsibilities SEP-10
defines (receive a challenge, verify it, sign it, submit it for a token).

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
