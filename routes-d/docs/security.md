# Security Headers — routes-d

This document describes the baseline security headers applied by
`routes-d/middleware/secureHeaders.ts` and the rationale behind each chosen
value. It also covers when and how to opt out of a header on a per-route basis.

---

## Applied Headers and Values

### `Strict-Transport-Security: max-age=31536000; includeSubDomains`

Instructs browsers to use HTTPS exclusively for this origin (and all
subdomains) for 365 days after the most recent response. Prevents SSL-stripping
attacks and downgrade attempts.

**`includeSubDomains`** is included because Nextellar's API, admin panel, and
staging environments all share the same top-level domain. Remove this directive
only when a subdomain is intentionally served over plain HTTP (e.g., a static
asset CDN that pre-dates the HTTPS migration).

### `X-Content-Type-Options: nosniff`

Prevents browsers from MIME-sniffing a response away from the declared
`Content-Type`. Without this header a browser could interpret a JSON payload as
executable HTML, enabling reflected-XSS vectors on older Chromium and IE
versions.

This header should almost never be omitted.

### `Referrer-Policy: strict-origin-when-cross-origin`

Controls how much of the URL is included in the `Referer` header on outgoing
navigation:

| Request type | Value sent |
|---|---|
| Same origin | Full URL |
| Cross-origin, HTTPS → HTTPS | Origin only (`https://app.nextellar.dev`) |
| Cross-origin, HTTPS → HTTP | Nothing |

This balances analytics usefulness (same-origin full URL) against privacy
(no path leakage to third parties over HTTPS, nothing at all on downgrade).

### `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`

Disables browser features that Nextellar does not use. An empty list `()` means
_no origin_ — including the page itself — is allowed to use that feature.
This limits the blast radius if a dependency or injected script tries to access
sensitive device APIs.

Extend the list if future features require additional permissions:
```
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(self)
```

---

## Opt-Out — Per-Route Exceptions

Use the `secureHeaders({ omit: [...] })` factory instead of the global
`app.use(secureHeaders())` for routes that legitimately cannot carry a
particular header.

```ts
import { secureHeaders } from "../middleware/secureHeaders.js";

// Health-check served over plain HTTP in local dev — HSTS would break it.
app.get(
  "/health",
  secureHeaders({ omit: ["Strict-Transport-Security"] }),
  healthHandler,
);

// Legacy iframe integration requires relaxed Referrer-Policy.
app.get(
  "/embed/widget",
  secureHeaders({ omit: ["Referrer-Policy"] }),
  widgetHandler,
);
```

**Rules for opt-outs:**

1. Document the reason in a code comment next to the route definition.
2. Omit only the specific header that causes the conflict; keep all others.
3. Prefer fixing the underlying conflict (e.g., move the route behind HTTPS)
   over a permanent opt-out.
4. Opt-outs must be reviewed in code review; do not merge without justification.

---

## Adding or Changing a Header Value

Edit `SECURE_HEADER_DEFAULTS` in `routes-d/middleware/secureHeaders.ts`.
The tests in `routes-d/tests/middleware/secureHeaders.test.ts` validate the
presence and value of each header — update them to reflect any intentional
change.

Before removing a header entirely, verify the reason and update this document.

---

## References

- [MDN — HTTP Security Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers#security)
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [RFC 6797 — HSTS](https://datatracker.ietf.org/doc/html/rfc6797)
- [Permissions Policy specification](https://www.w3.org/TR/permissions-policy/)
