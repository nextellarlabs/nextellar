# Environment Variables Reference

This page provides a complete reference for all environment variables supported by Nextellar CLI and scaffolded applications.

## Public Web Application Variables

These variables are consumed by Next.js client-side code and must be prefixed with `NEXT_PUBLIC_` to be bundled into browser builds.

| Variable Name | Default Value | Description |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | Target Stellar network (`testnet`, `mainnet`, `futurenet`, `standalone`). |
| `NEXT_PUBLIC_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Stellar Horizon REST API URL for balance queries and ledger state. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC server endpoint for contract simulation and submissions. |
| `NEXT_PUBLIC_FRIENDBOT_URL` | `https://friendbot.stellar.org` | Friendbot API URL for funding test accounts on testnet. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Canonical web application URL used for OpenGraph images and OAuth redirects. |
| `NEXT_PUBLIC_WALLET_NETWORK_PASSPHRASE` | `Test SDF Network ; July 2015` | Network passphrase passed to Stellar Wallet Kit and transaction builders. |

## CLI & Development Environment Variables

These variables configure the Nextellar CLI tool behavior and telemetry during project scaffolding.

| Variable Name | Default Value | Description |
|---|---|---|
| `NEXTELLAR_TELEMETRY_DISABLED` | `0` | Set to `1` or `true` to opt out of anonymous CLI usage telemetry collection. |
| `NEXTELLAR_VERBOSE_LOGS` | `0` | Set to `1` to enable detailed debug logging during contract code binding generation. |
| `NEXTELLAR_TEMPLATE_CACHE_DIR` | `~/.nextellar/cache` | Local directory path where project templates are cached. |
