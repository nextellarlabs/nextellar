# Currency Display Formatting Endpoint (`routes-d`)

This endpoint formats amounts for display per locale and currency in a deterministic manner. It supports ISO-4217 currency codes, Stellar native Lumens (`XLM` / `native`), custom Stellar crypto tokens, and handles edge precision scenarios.

## Endpoints

- `GET /format/currency`
- `POST /format/currency`

## Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `amount` | `number` \| `string` | **Yes** | - | Numeric amount to format |
| `currency` | `string` | **Yes** | - | ISO-4217 code (e.g. `USD`, `EUR`, `JPY`) or Stellar token (`XLM`, `native`, `USDC`) |
| `locale` | `string` | No | `"en-US"` | BCP 47 locale string (e.g. `"en-US"`, `"de-DE"`, `"fr-FR"`, `"ja-JP"`) |
| `decimals` | `number` | No | - | Override fixed number of fraction digits |
| `minDecimals` | `number` | No | - | Minimum fraction digits |
| `maxDecimals` | `number` | No | - | Maximum fraction digits |

## Example Requests

### 1. ISO 4217 Currency (USD in en-US)
```http
POST /format/currency
Content-Type: application/json

{
  "amount": 1234.56,
  "currency": "USD",
  "locale": "en-US"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "formatted": "$1,234.56",
    "amount": 1234.56,
    "currency": "USD",
    "locale": "en-US",
    "isNative": false
  }
}
```

### 2. Stellar Native Lumens (XLM with 7 decimal precision)
```http
POST /format/currency
Content-Type: application/json

{
  "amount": 0.0000001,
  "currency": "XLM",
  "locale": "en-US"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "formatted": "0.0000001 XLM",
    "amount": 0.0000001,
    "currency": "XLM",
    "locale": "en-US",
    "isNative": true
  }
}
```

### 3. Unknown Currency Code Error
```http
POST /format/currency
Content-Type: application/json

{
  "amount": 100,
  "currency": "INVALID_XYZ"
}
```

**Response (400 Bad Request)**:
```json
{
  "error": {
    "code": "UNKNOWN_CURRENCY",
    "message": "Unknown or unsupported currency code: 'INVALID_XYZ'"
  }
}
```
