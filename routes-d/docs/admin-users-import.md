# Admin Bulk User Import

`POST /admin/users/import`

Bulk-imports users from a CSV file for partner onboarding. Every row is validated individually and the response includes per-row outcomes, so callers can handle partial failures without re-sending the entire file.

---

## Authentication

The endpoint uses the operator-header auth scheme shared by all admin routes.

| Header | Required | Description |
|--------|----------|-------------|
| `x-operator-id` | ✅ | Identifies the calling operator (e.g. `partner-acme`) |
| `x-operator-scopes` | ✅ | Comma-separated scope list. Must include `import` |

```
x-operator-id: partner-acme
x-operator-scopes: import,read
```

---

## Request

### Content-Type options

| Content-Type | Body format |
|---|---|
| `text/csv` | Raw CSV bytes |
| `application/octet-stream` | Raw CSV bytes |
| `text/plain` | Raw CSV bytes |
| `multipart/form-data` | Raw multipart body (CSV as the only part) |
| `application/json` | JSON object with a `"csv"` string field |

Maximum payload size: **10 MB**.

### CSV format

The CSV must have a header row. Column names are case-insensitive.

| Column | Required | Rules |
|--------|----------|-------|
| `email` | ✅ | Must be a valid e-mail address |
| `firstname` | ✅ | Max 100 characters |
| `lastname` | ✅ | Max 100 characters |
| `country` | ✅ | 2-letter ISO 3166-1 alpha-2 code (e.g. `US`, `GB`) |
| `role` | ❌ | One of `user`, `admin`, `partner`. Defaults to `user` |

Extra columns are accepted and passed through unchanged.

**Example:**

```csv
email,firstname,lastname,country,role
alice@example.com,Alice,Smith,US,user
bob@example.com,Bob,Jones,GB,partner
```

---

## Response

### 200 OK – all rows accepted

```json
{
  "success": true,
  "data": {
    "contentHash": "e3b0c44298fc1c149afb...",
    "duplicate": false,
    "submittedBy": "partner-acme",
    "accepted": 2,
    "rejected": 0,
    "results": [
      { "row": 0, "email": "alice@example.com", "status": "accepted" },
      { "row": 1, "email": "bob@example.com",   "status": "accepted" }
    ]
  }
}
```

### 207 Multi-Status – partial failure

Returned when at least one row was rejected. Accepted rows are still persisted.

```json
{
  "success": true,
  "data": {
    "contentHash": "abc123...",
    "duplicate": false,
    "submittedBy": "partner-acme",
    "accepted": 1,
    "rejected": 1,
    "results": [
      { "row": 0, "email": "alice@example.com", "status": "accepted" },
      {
        "row": 1,
        "email": "bad-email",
        "status": "rejected",
        "errors": ["email: email is not a valid address"]
      }
    ]
  }
}
```

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `contentHash` | `string` | SHA-256 hex digest of the raw CSV bytes |
| `duplicate` | `boolean` | `true` when this exact CSV was already imported |
| `submittedBy` | `string` | Operator ID from `x-operator-id` |
| `accepted` | `number` | Count of rows successfully imported |
| `rejected` | `number` | Count of rows that failed validation |
| `results` | `array` | Per-row outcome objects (see below) |

#### `results[n]` fields

| Field | Type | Description |
|-------|------|-------------|
| `row` | `number` | 0-based row index (header excluded) |
| `email` | `string` | Email value from that row (best-effort for invalid rows) |
| `status` | `"accepted"` \| `"rejected"` | Outcome |
| `errors` | `string[]` | Validation error messages (only present when `status === "rejected"`) |

---

## Idempotency

The route is idempotent against re-uploads of the **exact same bytes**.

The SHA-256 hash of the raw CSV is computed before parsing. If an import with that hash already exists in the store (TTL: 24 hours), the cached `ImportRecord` is returned immediately with `duplicate: true`. No rows are re-processed and no users are re-inserted.

This means:

- Safe to retry on network failure without duplicating data.
- Adding even a single byte (e.g. a blank line) produces a different hash and triggers a new import.

---

## Error responses

| HTTP | `error.code` | Cause |
|------|-------------|-------|
| 400 | `EMPTY_PAYLOAD` | Body is empty |
| 400 | `INVALID_JSON` | `application/json` body is not valid JSON |
| 400 | `MISSING_CSV_FIELD` | JSON body lacks the `"csv"` string field |
| 401 | `UNAUTHORIZED` | `x-operator-id` header missing |
| 403 | `FORBIDDEN` | Operator lacks the `import` scope |
| 413 | `PAYLOAD_TOO_LARGE` | CSV exceeds 10 MB |
| 415 | `UNSUPPORTED_CONTENT_TYPE` | Content-Type not accepted |
| 422 | `MISSING_CSV_COLUMNS` | CSV header is missing one or more required columns |

All error responses follow the standard envelope:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Operator identity required" } }
```

---

## Implementation notes

### Source files

| File | Purpose |
|------|---------|
| `routes-d/routes/admin.users.import.ts` | Express router – request parsing, auth, response shaping |
| `routes-d/lib/importProcessor.ts` | Orchestration: parse → validate → persist → finalise record |
| `routes-d/lib/csvParser.ts` | Zero-dependency RFC 4180 CSV parser |
| `routes-d/lib/userValidator.ts` | Per-row field validation with typed error results |
| `routes-d/lib/importHashStore.ts` | In-memory SHA-256 idempotency store with TTL sweep |
| `routes-d/middleware/authMiddleware.ts` | `requireOperator` + `requireScope` middleware factories |

### Production checklist

- Replace the in-memory `importedUsers` map in `importProcessor.ts` with a real database adapter.
- Replace the in-memory `importHashStore` with Redis (or equivalent) for cross-instance idempotency and durability.
- Consider rate-limiting the endpoint per `x-operator-id` to prevent CSV flooding.
- Add a background job to notify operators of import results via webhook (see `routes-d/routes/webhooks.*` for the webhook pattern).

---

## Example cURL calls

### Raw CSV upload

```bash
curl -s -X POST https://api.nextellar.dev/admin/users/import \
  -H "Content-Type: text/csv" \
  -H "x-operator-id: partner-acme" \
  -H "x-operator-scopes: import" \
  --data-binary @users.csv | jq .
```

### JSON-wrapped upload

```bash
CSV=$(cat users.csv)
curl -s -X POST https://api.nextellar.dev/admin/users/import \
  -H "Content-Type: application/json" \
  -H "x-operator-id: partner-acme" \
  -H "x-operator-scopes: import" \
  -d "{\"csv\": $(echo "$CSV" | jq -Rs .)}" | jq .
```
