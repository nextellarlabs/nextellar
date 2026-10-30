# SEP-38 Quote/Pricing Troubleshooting Guide

This guide maps common `useSep38Quote` / `lib/sep38.ts` failures to their
underlying causes and recommended fixes. All request failures throw a
`Sep38Error` (with an optional `.status` for HTTP-level failures), visible
via `useSep38Quote()`'s `error` field after `getIndicativePrice`/
`getFirmQuote` rejects.

---

## 1. Exactly one of sellAmount/buyAmount is required

### Error Message
```text
fetchSep38IndicativePrice: exactly one of sellAmount or buyAmount is required.
fetchSep38FirmQuote: exactly one of sellAmount or buyAmount is required.
```

### Cause
Per SEP-38, a price/quote request must specify exactly one side of the
trade (how much you're selling, or how much you want to buy) — never both,
and never neither. This is checked client-side before any request is sent,
so no network call happens at all.

### Fix / Resolution
Pass exactly one of `sellAmount` or `buyAmount` (as a string decimal) in the
params to `getIndicativePrice`/`getFirmQuote`, not both and not neither.

---

## 2. Unsupported asset pair (400/404 from the anchor)

### Error Message
```text
SEP-38 request failed (400): <anchor-provided detail>
SEP-38 request failed (404): <anchor-provided detail>
```

### Cause
The anchor's quote server doesn't support converting between the given
`sellAsset`/`buyAsset` pair — most commonly because one of the two assets
isn't a `sell_delivery_method`/`buy_delivery_method` the anchor handles, or
the asset identifier is malformed (SEP-38 uses the `<scheme>:<identifier>`
form, e.g. `iso4217:USD` or `stellar:USDC:GISSUER...`, not a bare asset
code).

### Fix / Resolution
1. Call `GET /prices` on the anchor's quote server directly (or check its
   published `/info` endpoint, if it has one) to confirm the pair is
   actually supported before requesting a price for it.
2. Double-check both asset identifiers are in SEP-38's
   `<scheme>:<identifier>` form, not a bare code.

---

## 3. Firm quote request returns 401 Unauthorized

### Error Message
```text
SEP-38 request failed (401): <anchor-provided detail>
```

### Cause
`getFirmQuote` requires a SEP-10 `authToken` (per SEP-38 §POST /quote);
`getIndicativePrice` does not. A missing, expired, or wrong-account JWT on a
firm quote request surfaces as a 401 here.

### Fix / Resolution
1. Confirm `authToken` is actually being passed to `getFirmQuote` (it's a
   required field on `Sep38QuoteParams & { authToken: string }`, unlike the
   indicative-price params).
2. Re-run the SEP-10 auth flow if the JWT has expired.

---

## 4. Quote expired before it could be used (`isExpired`)

### Symptom
`useSep38Quote()`'s `isExpired` is `true` for the current `quote`, or a
transaction built from an expired quote's `id` is rejected by the anchor at
execution time.

### Cause
A **firm** quote (`quote.kind === 'firm'`) is binding only until its
`expiresAt` timestamp, taken as-is from the anchor's response. `isExpired`
is derived purely from comparing `expiresAt` to the current time — it is
never fabricated or extended client-side, and it's always `false` for an
**indicative** price, which has no expiry at all (don't treat an indicative
price as if it were still valid after some elapsed time just because
`isExpired` reads `false` for it).

### Fix / Resolution
1. Check `isExpired` immediately before using `quote.id` in a transaction —
   if it's `true`, request a fresh firm quote rather than submitting against
   a stale one.
2. If quotes are expiring faster than your flow can use them, pass a longer
   `expireAfter` (ISO 8601 timestamp) to `getFirmQuote` — the anchor may
   still return an earlier `expiresAt` than requested, so always check the
   actual value returned rather than assuming `expireAfter` was honored.
3. Call `reset()` to clear a stale quote from the hook's state before
   requesting a new one, if your UI needs to distinguish "no quote yet" from
   "had a quote, now expired."

---

## 5. Malformed or incomplete anchor response

### Error Message
```text
SEP-38 response from "<url>" was not valid JSON: <parse error>
fetchSep38FirmQuote: server response is missing required expires_at.
```

### Cause
The anchor's response body either isn't valid JSON, or (for a firm quote)
is missing `expires_at` — a field SEP-38 requires on every `POST /quote`
response. This is a server-side anchor bug, not a client misconfiguration.

### Fix / Resolution
1. Confirm you're pointed at the correct quote server URL — a misconfigured
   URL pointing at an unrelated service (one that returns HTML or a
   different JSON shape) produces exactly this symptom.
2. If the URL is correct, this is the anchor's bug to fix — report it with
   the exact request made and the raw response body.
