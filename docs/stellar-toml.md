# stellar.toml for apps that issue assets (SEP-1)

Every scaffolded app ships `public/.well-known/stellar.toml` — the SEP-1
metadata file Stellar wallets and anchors fetch to discover who issues an
app's assets. It is served at `/.well-known/stellar.toml` with CORS enabled
so any origin can read it.

## What it is

[SEP-1](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
defines `stellar.toml` as the well-known file an issuer publishes. The two
sections that matter for an issuing app are:

- `ACCOUNTS` — the Stellar accounts (G... public keys) that issue the
  app's assets.
- `[[CURRENCIES]]` — one block per asset, with the asset `code` and the
  `issuer` account from `ACCOUNTS`.

## Fill in the placeholders

The shipped file is a template. Replace every placeholder with your real
values before you issue an asset:

| Placeholder | Replace with |
| --- | --- |
| `G_REPLACE_WITH_YOUR_ISSUER_ACCOUNT` | The issuing account's Stellar public key (starts with `G`). |
| `REPLACE_WITH_ASSET_CODE` | The asset code (up to 12 characters, e.g. `USD`). |

Add one `[[CURRENCIES]]` block per asset, and one entry in `ACCOUNTS`
per issuing account.

The placeholders deliberately do not use the scaffold's `{{TOKEN}}`
syntax: scaffold has no issuer or asset values to substitute, and any
`{{TOKEN}}` left in scaffolded output fails the placeholder-hygiene test
(#680). They follow the contracts overlay's `C_REPLACE_WITH_YOUR_CONTRACT_ID`
precedent instead.

## How it is served

Each template's `next.config` adds a headers rule for
`/.well-known/stellar.toml`:

- `Access-Control-Allow-Origin: *` — SEP-1 requires the file to be
  fetchable cross-origin; wallets and anchors read it from any origin.
- `Content-Type: text/plain` — the correct content type for a `.toml` file.

The rule sits after the global `/:path*` rule, so the security headers
still apply to this path too. Next.js merges matching rules in order, and
neither of these two keys appears in the global rule, so nothing is
overridden.

## How doctor validates it

`nextellar doctor` includes a `stellar-toml` check:

- **File absent** — passes as not-applicable. Most apps never issue assets,
  so this is not an error.
- **Placeholders still in place** — optional failure (a warning; it never
  fails the doctor run). Fill in the values from the table above.
- **Placeholders filled in** — passes.

## See also

- [SEP-1](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
- [Anchor discovery & KYC fields](./anchor-discovery-and-kyc.md)
- [`nextellar doctor --json` output schema](./doctor-json.md)
