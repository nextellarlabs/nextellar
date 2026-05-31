# Rate Limits — routes-d

All routes-d endpoints enforce per-IP and per-account rate limits to protect
Horizon, the Soroban RPC, and the Nextellar database.

---

## Per-Route Limits

| Route | Window | Limit | Burst |
|-------|--------|-------|-------|
| `POST /auth/login` | 15 min | 10 requests | 3 |
| `POST /auth/register` | 1 hour | 5 requests | 1 |
| `POST /auth/refresh` | 15 min | 30 requests | 5 |
| `POST /auth/logout` | 1 min | 10 requests | 10 |
| `GET /orders` | 1 min | 120 requests | 20 |
| `POST /orders` | 1 min | 30 requests | 5 |
| `GET /orders/:id` | 1 min | 200 requests | 30 |
| `DELETE /orders/:id` | 1 min | 20 requests | 5 |
| `GET /horizon/*` (proxy) | 1 min | 60 requests | 10 |
| `POST /soroban/simulate` | 1 min | 30 requests | 5 |
| `POST /soroban/send` | 1 min | 10 requests | 2 |
| `GET /health` | 1 min | 600 requests | 100 |

> **Burst** = extra requests allowed in the first second of a new window.

---

## Response Headers

Every response from a rate-limited endpoint includes these headers:

```
X-RateLimit-Limit:     120
X-RateLimit-Remaining: 87
X-RateLimit-Reset:     1717171200
Retry-After:           34          ← present only on 429 responses
```

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `Retry-After` | Seconds to wait before retrying (429 only) |

---

## 429 Response Body

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please wait 34 seconds before retrying.",
  "retryAfter": 34
}
```

---

## Retry-After Contract

- `Retry-After` is **always** present on `429 Too Many Requests` responses.
- The value is a positive integer (seconds).
- Clients **must** honour this value — immediate retries will be rejected and
  may result in an extended block on the IP.
- The window resets hard at `X-RateLimit-Reset`; `Retry-After` is the
  remaining time in the *current* window, so `Retry-After ≤ window_size`.

---

## Client Retry Example (TypeScript / fetch)

```ts
async function requestWithRetry(
  url: string,
  init?: RequestInit,
  maxAttempts = 4,
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);

    if (res.status !== 429) return res;

    const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
    if (attempt === maxAttempts) {
      throw new Error(`Rate limited after ${maxAttempts} attempts. Retry in ${retryAfter}s.`);
    }

    // Honour the Retry-After header with a small jitter to spread load
    const jitter = Math.random() * 1_000;
    const delay = retryAfter * 1_000 + jitter;
    console.warn(`Rate limited (attempt ${attempt}/${maxAttempts}). Waiting ${Math.ceil(delay)}ms…`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Unreachable");
}

// Usage
const response = await requestWithRetry("/api/orders", {
  method: "GET",
  headers: { Authorization: `Bearer ${token}` },
});
const data = await response.json();
```

---

## Global IP Block

Repeated 429s without honouring `Retry-After` may trigger a temporary IP-level
block enforced at the load balancer (separate from per-route limits). The block
duration starts at **5 minutes** and doubles on each subsequent violation, up to
**24 hours**.
