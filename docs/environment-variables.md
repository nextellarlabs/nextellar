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
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | none (WalletConnect hidden) | Required to enable the WalletConnect wallet option. Must be the 32-character hex project ID from a project created at [cloud.reown.com](https://cloud.reown.com) (formerly WalletConnect Cloud). When unset, `readWalletConnectConfig` returns `null` and the app simply does not offer WalletConnect as a wallet choice; other wallet adapters are unaffected. See `docs/walletconnect-guide.md`. |
| `NEXT_PUBLIC_WALLETCONNECT_RELAY_URL` | `wcs://relay.walletconnect.com/` | WalletConnect relay server URL used by the WalletConnect adapter. |
| `NEXT_PUBLIC_WALLETCONNECT_APP_URL` | current page origin (or `http://localhost:3000` during server-side rendering) | Optional `https://` URL of your dApp, shown to the user inside their wallet app during a WalletConnect pairing request. Ignored if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. |
| `NEXT_PUBLIC_WALLETCONNECT_ICON` | none (no icon shown) | Optional `https://` URL of a square icon, shown alongside the app name during pairing. Ignored if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. |
| `NEXT_PUBLIC_APP_NAME` | `Nextellar dApp` | Display name shown to the user inside their wallet app during a WalletConnect pairing request. |

## CLI & Development Environment Variables

These variables configure Nextellar CLI tool behavior and telemetry during project scaffolding.

| Variable Name | Default Value | Description |
|---|---|---|
| `NEXTELLAR_TELEMETRY_DISABLED` | `0` | Set to `1` or `true` to opt out of anonymous CLI usage telemetry collection. |
| `NEXTELLAR_VERBOSE_LOGS` | `0` | Set to `1` to enable detailed debug logging during contract code binding generation. |
| `NEXTELLAR_TEMPLATE_CACHE_DIR` | `~/1.nextellar/cache` | Local directory path where project templates are cached. |