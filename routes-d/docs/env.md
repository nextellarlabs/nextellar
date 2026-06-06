# Environment Variables — routes-d

Single reference for every environment variable consumed by routes-d.
Variables marked **Secret** must never be committed to version control or
logged.

---

## Horizon / Stellar

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `HORIZON_URL` | Primary Horizon base URL (alias for `HORIZON_PRIMARY_URL`) | `https://horizon-testnet.stellar.org` | No | No |
| `HORIZON_PRIMARY_URL` | Primary Horizon base URL | `https://horizon-testnet.stellar.org` | No | No |
| `HORIZON_FALLBACK_URL` | Fallback Horizon URL used when the primary is unhealthy | — | No | No |
| `HORIZON_TIMEOUT_MS` | Per-request timeout for Horizon calls in milliseconds | `5000` | No | No |
| `NEXTELLAR_HORIZON_URL` | Alternate Horizon URL used by some internal helpers | `https://horizon-testnet.stellar.org` | No | No |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | — | Yes | No |
| `SOROBAN_SIGNING_SECRET` | Ed25519 secret key for signing Soroban transactions | — | Yes | **Yes** |
| `STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase (`Public Global Stellar Network ; September 2015` for mainnet) | — | Yes | No |
| `NEXTELLAR_BALANCE_CACHE_TTL_MS` | TTL for in-memory Stellar balance cache in milliseconds | `30000` | No | No |

---

## Authentication & Tokens

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `NEXTELLAR_JWT_ISSUER` | `iss` claim used when minting JWTs | — | Yes | No |
| `NEXTELLAR_JWT_AUDIENCE` | `aud` claim checked when verifying JWTs | — | Yes | No |
| `NEXTELLAR_IMPERSONATION_SECRET` | HMAC secret that authorises operator impersonation requests | — | Yes | **Yes** |
| `NEXTELLAR_SESSION_TTL_SECONDS` | Access token lifetime in seconds | `900` | No | No |
| `NEXTELLAR_MAGIC_LINK_BASE_URL` | Base URL prepended to magic-link tokens | — | Yes | No |
| `NEXTELLAR_MAGIC_LINK_TTL_SECONDS` | Magic link expiry in seconds | `900` | No | No |
| `NEXTELLAR_CHALLENGE_TTL_MS` | Stellar wallet sign-challenge validity window in milliseconds | `300000` | No | No |
| `ROUTES_D_CURSOR_SECRET` | HMAC secret used to sign and verify pagination cursors | — | Yes | **Yes** |
| `ROUTES_D_ADMIN_TOKEN` | Static bearer token granting admin-only endpoint access | — | Yes | **Yes** |

---

## Rate Limiting

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `NEXTELLAR_LOGIN_RATE_WINDOW_MS` | Sliding-window size for the login rate limiter in milliseconds | `900000` | No | No |
| `NEXTELLAR_LOGIN_RATE_IP_LIMIT` | Maximum login attempts per IP per window | `20` | No | No |
| `NEXTELLAR_LOGIN_RATE_IP_EMAIL_LIMIT` | Maximum login attempts per IP+email pair per window | `5` | No | No |

---

## CORS & Security

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `ALLOWED_ORIGINS` | Comma-separated list of exact origins permitted by CORS middleware | — | Yes | No |

---

## Audit & Activity Logging

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `AUDIT_LOG_DIR` | Directory where structured audit log files are written | — | Yes | No |
| `AUDIT_PEPPER` | HMAC pepper mixed into audit log hashes | — | Yes | **Yes** |
| `USER_ACTIVITY_LOG_DIR` | Directory where user-activity events are written | — | Yes | No |
| `USER_ACTIVITY_PEPPER` | HMAC pepper mixed into user-activity hashes | — | Yes | **Yes** |

---

## SEP Anchor

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `NEXTELLAR_SEP` | Comma-separated list of active SEP protocols (e.g. `24,31`) | — | No | No |

---

## Orders & Inventory

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `NEXTELLAR_INVENTORY_RESERVATION_TIMEOUT_MS` | How long (ms) an inventory reservation is held before expiry | `30000` | No | No |
| `NEXTELLAR_SEQUENCE_RESERVATION_TIMEOUT_MS` | How long (ms) a Stellar sequence-number reservation is held | `30000` | No | No |

---

## Runtime

| Variable | Purpose | Default | Required | Secret |
|----------|---------|---------|----------|--------|
| `NODE_ENV` | Runtime mode (`development`, `test`, `production`) | `development` | No | No |
| `NEXTELLAR_SHUTDOWN_TIMEOUT_MS` | Grace period (ms) between SIGTERM and hard exit | `10000` | No | No |

---

## Notes

- All durations are in **milliseconds** unless the variable name ends in `_SECONDS`.
- Secret variables must be supplied via a secrets manager (AWS Secrets Manager,
  HashiCorp Vault, etc.) in production. Do **not** write real values into
  `.env.example` or commit them to the repository.
- Copy `.env.example` to `.env` and fill in the blanks before starting the
  development server.
