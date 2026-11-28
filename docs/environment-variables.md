# Environment Variables Reference

This page provides a complete reference for all environment variables supported by Nextellar CLI and scaffolded applications.

## Validation & Required Variables

Environment variables are validated during CLI initialization. Missing or invalid values fall back to defaults, but warnings are logged when required variables for a specific network are absent:

- `NEXT_PUBLIC_STELLAR_NETWORK`: Must be one of `testnet`, `mainnet`, `futurenet`, or `standalone`. Invalid values default to `testnet`.
- `NEXT_PUBLIC_HORIZON_URL` and `NEXT_PUBLIC_SOROBAN_RPC_URL`: Must be valid HTTPS URLs (or `http://localhost` for development). Validation occurs at build time; malformed URLs will cause the scaffolded app's initialization to fail with a clear error message.

Always validate these values in your CI/CD pipeline before deploying to production.

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
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | none (WalletConnect hidden) | Required to enable the WalletConnect wallet option. Must be the 32-character hex project ID from a project created at [cloud.reown.com](https://cloud.reown.com) (formerly WalletConnect Cloud). When unset, `readWalletConnectConfig` returns `null` and the app simply does not offer WalletConnect as a wallet choice; other wallet adapters are unaffected. See `docs/custom-wallet-adapter-guide.md`. |
| `NEXT_PUBLIC_WALLETCONNECT_APP_URL` | current page origin (or `http://localhost:3000` during server-side rendering) | Optional `https://` URL of your dApp, shown to the user inside their wallet app during a WalletConnect pairing request. Ignored if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. |
| `NEXT_PUBLIC_WALLETCONNECT_ICON` | none (no icon shown) | Optional `https://` URL of a square icon, shown alongside the app name during pairing. Ignored if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. |
| `NEXT_PUBLIC_APP_NAME` | `Nextellar dApp` | Display name shown to the user inside their wallet app during a WalletConnect pairing request. |
| `NEXT_PUBLIC_HORIZON_PROXY` | unset (disabled) | Set to `1`, `true`, `yes` or `on` to route client Horizon reads through the template's `/api/horizon` proxy. See `docs/horizon-proxy.md`. |

## Server-Only Horizon Proxy Variables (Default Template)

These variables are read only by the `/api/horizon/[...path]` route handler. They must **not** be prefixed with `NEXT_PUBLIC_`, so the provider key never reaches the browser.

| Variable Name | Default Value | Description |
|---|---|---|
| `HORIZON_PROXY_URL` | `NEXT_PUBLIC_HORIZON_URL`, then `https://horizon-testnet.stellar.org` | Upstream Horizon base URL used by the proxy. |
| `HORIZON_PROXY_API_KEY` | none | Provider API key injected server-side. |
| `HORIZON_PROXY_API_KEY_HEADER` | `Authorization` | Header that carries the key (`Authorization` is sent as `Bearer <key>`). |
| `HORIZON_PROXY_CACHE_TTL_MS` | `3000` | In-memory cache TTL for successful proxied GETs; `0` disables caching. |
| `HORIZON_PROXY_TIMEOUT_MS` | `10000` | Upstream request timeout; `0` disables the timeout. |

## CLI & Development Environment Variables

These variables configure the Nextellar CLI tool behavior and telemetry during project scaffolding.

| Variable Name | Default Value | Description |
|---|---|---|
| `NEXTELLAR_TELEMETRY_DISABLED` | `0` | Set to `1` or `true` to opt out of anonymous CLI usage telemetry collection. |
| `NEXTELLAR_VERBOSE_LOGS` | `0` | Set to `1` to enable detailed debug logging during contract code binding generation. |
| `NEXTELLAR_TEMPLATE_CACHE_DIR` | `~/.nextellar/cache` | Local directory path where project templates are cached. |
