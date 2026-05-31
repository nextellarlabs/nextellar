# Audit Logging for Failed Auth (routes-d)

## Overview

`routes-d` captures every failed login or token verification for incident response and abuse detection. All data lives under `routes-d/` — no edits outside this folder.

## Architecture
routes-d/
├── lib/
│   └── auditLog.ts      # Core logging library
├── routes/
│   └── audit.ts          # Admin query endpoint
├── middleware/
│   └── auditAuth.ts      # Auto-logging wrapper
├── tests/
│   ├── auditLog.unit.test.ts
│   └── audit.integration.test.ts
└── docs/
└── audit-logging.md  # This file

## Security Guarantees

- **Passwords are NEVER logged** — sanitized before storage
- **Tokens are NEVER logged** — redacted in reason strings
- **Identifiers are hashed** (SHA-256 + pepper) — correlatable but not reversible
- **Entries pass `isSafeEntry()` guard** — runtime verification

## API

### `recordFailedAuth(params)`

Log a failed authentication attempt.

```typescript
import { recordFailedAuth } from "./lib/auditLog.js";

recordFailedAuth({
  ip: "192.168.1.1",
  identifier: "user@example.com", // Will be hashed
  identifierType: "email", // or "pubkey" | "wallet"
  reason: "Invalid password",
  route: "POST /api/auth/login",
  userAgent: "Mozilla/5.0...",
});

queryAuditLogs(filters)
Query logs (admin-only).

import { queryAuditLogs } from "./lib/auditLog.js";

const result = queryAuditLogs({
  startDate: "2026-05-01",
  endDate: "2026-05-31",
  identifier: "user@example.com", // Will be hashed for comparison
  reason: "Expired",
  limit: 50,
  offset: 0,
});
// Returns: { entries, total, page, pageSize }

getAuditSummary(hours)
Get abuse detection summary.
const summary = getAuditSummary(24);
// {
//   totalAttempts: 150,
//   uniqueIdentifiers: 45,
//   topReasons: [{ reason: "Invalid password", count: 89 }],
//   topIps: [{ ip: "10.0.0.1", count: 23 }]
// }

Admin Endpoint
GET /api/routes-d/audit?startDate=2026-05-01&endDate=2026-05-31
Headers: x-admin-token: <ADMIN_TOKEN>

Query params:
| Param        | Description                                  |
| ------------ | -------------------------------------------- |
| `startDate`  | Filter from date (ISO)                       |
| `endDate`    | Filter to date (ISO)                         |
| `identifier` | Filter by raw identifier (hashed internally) |
| `reason`     | Filter by reason substring                   |
| `limit`      | Page size (max 100)                          |
| `offset`     | Page number                                  |
| `summary`    | Set `true` for summary stats                 |
| `hours`      | Hours back for summary (default 24)          |


Environment Variables
| Variable               | Description                 | Default           |
| ---------------------- | --------------------------- | ----------------- |
| `AUDIT_LOG_DIR`        | Where to store JSONL logs   | `./routes-d/logs` |
| `AUDIT_PEPPER`         | Hash pepper for identifiers | dev fallback      |
| `ROUTES_D_ADMIN_TOKEN` | Token for admin endpoint    | Required in prod  |


Testing
cd routes-d
npm install
npm test