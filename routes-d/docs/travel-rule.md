# Travel Rule Data Exchange Endpoint

Exposes an API for partner Virtual Asset Service Providers (VASPs) to exchange
originator and beneficiary information as required by the FATF Travel Rule
(Recommendation 16).

## Routes

| Method | Path                                               | Description                        |
| ------ | -------------------------------------------------- | ---------------------------------- |
| POST   | `/compliance/travel-rule/transfers`                | Submit a travel rule record        |
| GET    | `/compliance/travel-rule/transfers/:transferId`    | Fetch an existing record (with PII)|

All routes require **mutual partner authentication** (see below).

---

## Authentication

### Mutual Partner Authentication

Every request must include three HTTP headers:

| Header           | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `X-Partner-Id`   | Your assigned partner identifier, e.g. `exchange-abc`             |
| `X-Partner-Ts`   | Current Unix timestamp in seconds (string)                         |
| `X-Partner-Sig`  | HMAC-SHA-256 signature (lowercase hex, 64 chars)                   |

#### Signature algorithm

```
message  = partnerId + ":" + timestamp + ":" + sha256(rawBody)
signature = HMAC-SHA-256(message, partnerSecret)
```

- `sha256(rawBody)` is the lowercase hex digest of the raw UTF-8 request body.
  For GET requests with no body, use the SHA-256 of an empty string.
- `partnerSecret` is the shared secret issued during partner onboarding.
- Requests with a timestamp older than **300 seconds** (configurable via
  `PARTNER_SIG_WINDOW_SECONDS`) are rejected.

#### Partner secret registration

Partner secrets are stored as environment variables:

```
TRAVEL_RULE_PARTNER_SECRET_<PARTNERID_UPPERCASE>
```

For example, a partner with id `exchange-abc` uses:

```
TRAVEL_RULE_PARTNER_SECRET_EXCHANGE_ABC=<shared-secret>
```

Hyphens in the partner id are converted to underscores. Secrets must be strong
random strings (≥ 32 bytes of entropy recommended).

---

## Field Encryption

Sensitive PII fields are encrypted at rest using **AES-256-GCM** before being
written to the store.

### Encrypted fields

- `originator.name`
- `originator.accountNumber`
- `beneficiary.name`
- `beneficiary.accountNumber`

### Key ID (`kid`) scheme

Each encrypted value carries a `kid` (key identifier) that links it to a
specific symmetric key. This allows transparent key rotation without
re-encrypting all existing records immediately.

#### Environment variables

| Variable                              | Description                                      |
| ------------------------------------- | ------------------------------------------------ |
| `TRAVEL_RULE_KEY_<KID>`               | 64-character hex-encoded 256-bit key             |
| `TRAVEL_RULE_KEY_ACTIVE`              | The `kid` used when encrypting new records (default `v1`) |

**Example – rotating to key `v2`:**

```bash
# Add the new key
TRAVEL_RULE_KEY_V2=<64-hex-chars>

# Switch encryption of new records to v2
TRAVEL_RULE_KEY_ACTIVE=v2

# Old records encrypted with v1 remain readable as long as TRAVEL_RULE_KEY_V1
# is still set.  Remove v1 only after all records have been migrated.
```

#### Wire format (EncryptedField)

Encrypted values are stored as JSON objects. They are never returned as-is in
API responses; the fetch endpoint always decrypts them before responding.

```json
{
  "kid":        "v1",
  "iv":         "<24-char hex>",
  "tag":        "<32-char hex>",
  "ciphertext": "<hex>"
}
```

---

## API Reference

### POST /compliance/travel-rule/transfers

Submit a travel rule record for an outbound transfer.

**Request body**

```json
{
  "transferId":   "string (unique, idempotency key)",
  "amount":       "number (positive)",
  "asset":        "string (e.g. USDC, XLM)",
  "originator": {
    "name":          "string",
    "accountNumber": "string",
    "address":       "string (optional)"
  },
  "beneficiary": {
    "name":          "string",
    "accountNumber": "string",
    "address":       "string (optional)"
  }
}
```

**Responses**

| Status | Condition                                    |
| ------ | -------------------------------------------- |
| 201    | Record created                               |
| 200    | Record already exists (`meta.duplicate: true`)|
| 400    | Validation error                             |
| 401    | Missing/invalid auth headers or signature    |
| 403    | Unknown partner id                           |

**201 response body** (PII fields are **not** returned on creation):

```json
{
  "success": true,
  "data": {
    "transferId":   "tr-001",
    "createdAt":    "2026-07-26T12:00:00.000Z",
    "submittedBy":  "exchange-abc",
    "amount":       500,
    "asset":        "USDC"
  }
}
```

---

### GET /compliance/travel-rule/transfers/:transferId

Fetch a previously submitted record. PII fields are decrypted in the response.

**Responses**

| Status | Condition                                    |
| ------ | -------------------------------------------- |
| 200    | Record found and returned with decrypted PII |
| 401    | Missing/invalid auth headers or signature    |
| 403    | Unknown partner id                           |
| 404    | Record not found                             |

**200 response body**:

```json
{
  "success": true,
  "data": {
    "transferId":   "tr-001",
    "createdAt":    "2026-07-26T12:00:00.000Z",
    "submittedBy":  "exchange-abc",
    "amount":       500,
    "asset":        "USDC",
    "originator": {
      "name":          "Alice Originator",
      "accountNumber": "GABC1234567890",
      "address":       "1 Main St"
    },
    "beneficiary": {
      "name":          "Bob Beneficiary",
      "accountNumber": "GXYZ9876543210"
    }
  }
}
```

---

## Error Envelope

All error responses follow the standard envelope:

```json
{
  "error": {
    "code":    "VALIDATION_ERROR",
    "message": "Human-readable description"
  }
}
```

### Error codes

| Code                    | HTTP status | Meaning                                          |
| ----------------------- | ----------- | ------------------------------------------------ |
| `VALIDATION_ERROR`      | 400         | Request body failed validation                   |
| `MISSING_AUTH_HEADERS`  | 401         | One or more auth headers are absent              |
| `INVALID_TIMESTAMP`     | 401         | `X-Partner-Ts` is not a valid number             |
| `REQUEST_EXPIRED`       | 401         | Timestamp is outside the allowed window          |
| `INVALID_SIGNATURE`     | 401         | HMAC verification failed                         |
| `UNKNOWN_PARTNER`       | 403         | The supplied `X-Partner-Id` has no registered secret |
| `NOT_FOUND`             | 404         | No record exists for the given `transferId`      |

---

## File Structure

```
routes-d/
├── auth/
│   └── mutualAuth.ts          # Partner mutual-auth middleware
├── lib/
│   ├── crypto.ts              # AES-256-GCM field encryption / decryption
│   └── response.ts            # sendError helper
├── middleware/
│   ├── errorHandler.ts        # Structured error handler + asyncHandler
│   └── index.ts               # Re-exports middleware for consumers
├── routes/
│   └── compliance.travelRule.ts  # Submit + fetch route handlers
├── tests/
│   ├── compliance.travelRule.test.ts      # Route-level tests
│   ├── unit/
│   │   ├── crypto.test.ts                 # Unit tests for crypto.ts
│   │   └── mutualAuth.test.ts             # Unit tests for mutualAuth.ts
│   └── integration/
│       └── compliance.travelRule.integration.test.ts
└── docs/
    └── travel-rule.md         # This file
```
