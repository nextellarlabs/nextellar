# API Authentication Guide — routes-d

All routes-d endpoints (except `/health` and `/auth/login`) require a valid
Bearer token in the `Authorization` header.

---

## Authentication Flows

### 1. Email + Password

```bash
# Obtain access token
curl -s -X POST https://api.nextellar.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"s3cr3t"}' | jq .

# Response
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "rt_abc123...",
  "expiresIn": 900
}
```

Use the `accessToken` as a Bearer token on every subsequent request:

```bash
curl https://api.nextellar.app/orders \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

### 2. Token Refresh

Access tokens expire after **15 minutes**. Use the refresh token to obtain a
new pair without re-entering credentials.

```bash
curl -s -X POST https://api.nextellar.app/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"rt_abc123..."}' | jq .

# Response
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...<new>",
  "refreshToken": "rt_xyz789...<rotated>",
  "expiresIn": 900
}
```

> Refresh tokens are **rotated** on every use. The old token is invalidated immediately.

---

### 3. OAuth (GitHub / Google)

```bash
# Step 1 — redirect the user to the provider
GET https://api.nextellar.app/auth/oauth/github

# Step 2 — callback (handled server-side)
GET https://api.nextellar.app/auth/oauth/github/callback?code=...&state=...

# Step 3 — response redirects to frontend with tokens in query params
# Frontend picks them up from the URL and stores them securely
```

---

### 4. Stellar Wallet (Freighter)

```bash
# Step 1 — get a sign challenge for the wallet address
curl -s https://api.nextellar.app/auth/stellar/challenge?address=GXXXXXX | jq .
# { "challenge": "nextellar-auth:1717171200:abc123" }

# Step 2 — sign the challenge with Freighter (client-side)
# const signed = await freighter.signMessage(challenge);

# Step 3 — exchange signed challenge for tokens
curl -s -X POST https://api.nextellar.app/auth/stellar/verify \
  -H "Content-Type: application/json" \
  -d '{"address":"GXXXXXX","signature":"<base64>","challenge":"nextellar-auth:..."}' | jq .

# Response — same shape as email/password
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "rt_abc123...",
  "expiresIn": 900
}
```

---

## Error Responses

| HTTP | `error` code | Meaning |
|------|-------------|---------|
| 400 | `invalid_credentials` | Wrong email/password |
| 400 | `invalid_challenge` | Challenge expired or tampered |
| 401 | `token_expired` | Access token has expired — refresh it |
| 401 | `token_invalid` | Malformed or revoked token |
| 403 | `refresh_token_reused` | Refresh token already rotated (possible replay attack) |
| 429 | `rate_limit_exceeded` | Too many requests — see [rate-limits.md](rate-limits.md) |

---

## Rate Limits for Auth Endpoints

See [rate-limits.md](rate-limits.md) for full details.

| Endpoint | Limit |
|----------|-------|
| `POST /auth/login` | 10 per 15 min |
| `POST /auth/register` | 5 per hour |
| `POST /auth/refresh` | 30 per 15 min |
