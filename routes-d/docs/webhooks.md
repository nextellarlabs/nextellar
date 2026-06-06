# Webhooks in `routes-d`

This folder currently emits outbound order webhooks from `routes-d/lib/orderWebhooks.ts`.

## `order.fulfilled`

- **Source**: `routes-d/lib/orderWebhooks.ts`
- **Payload schema**
  - `event`: `"order.fulfilled"`
  - `orderId`: string
  - `occurredAt`: unix epoch milliseconds
  - `data`: arbitrary JSON object
- **Signature scheme**: `X-Nextellar-Signature` carries an `HMAC-SHA256` hex digest of the raw JSON body.
- **Event header**: `X-Nextellar-Event: order.fulfilled`
- **Retry behavior**: `OrderWebhookDispatcher.dispatch()` retries transient failures with exponential backoff. It does not retry 4xx responses except `429`.
- **Example**
  ```json
  {
    "event": "order.fulfilled",
    "orderId": "123",
    "occurredAt": 1710000000000,
    "data": {
      "customer": "alice",
      "total": 49.5
    }
  }
  ```

## `order.shipped`

- **Source**: `routes-d/lib/orderWebhooks.ts`
- **Payload schema**
  - `event`: `"order.shipped"`
  - `orderId`: string
  - `occurredAt`: unix epoch milliseconds
  - `data`: arbitrary JSON object
- **Signature scheme**: `X-Nextellar-Signature` carries an `HMAC-SHA256` hex digest of the raw JSON body.
- **Event header**: `X-Nextellar-Event: order.shipped`
- **Retry behavior**: same as `order.fulfilled`.
- **Example**
  ```json
  {
    "event": "order.shipped",
    "orderId": "123",
    "occurredAt": 1710000005000,
    "data": {
      "carrier": "DHL",
      "trackingNumber": "ZX123"
    }
  }
  ```
