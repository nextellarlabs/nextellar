# Sanctions List Screening on Outgoing Payments

## Summary

Add sanctions list screening for outgoing payment destinations via a pluggable screening engine inside `routes-d/`.

## Changes

- **`routes-d/lib/sanctionsScreening.ts`** — Sanctions screening library with:
  - `SanctionsListSource` interface for pluggable list backends
  - Default in-memory list source with case-insensitive exact-match lookup
  - `screenDestination(destination, source?)` returns `clean`, `hit`, or `error` status
  - Built-in audit log recording every screening result with destination, decision, timestamp, and unique audit ID
  - Test helpers (`__setSanctionsList`, `__addSanctionsEntry`, `__setSourceError`, `__resetAll`)

- **`routes-d/routes/payments.screen.ts`** — `POST /payments/screen` endpoint:
  - Authentication via `x-user-id` header
  - Accepts `{ destination }` in request body
  - Returns `200` with `{ status: "clean" }` for non-listed destinations
  - Returns `403 SANCTIONS_HIT` for listed parties
  - Returns `503 SCREENING_UNAVAILABLE` when the list source is unreachable
  - Whitespace trimming on destination

- **`routes-d/tests/unit/sanctionsScreening.test.ts`** — Unit tests (18 tests) covering:
  - Clean (non-listed destination)
  - Hit (listed destination)
  - Case-insensitive matching
  - Source unavailable (error state)
  - Source throws during check
  - Empty list
  - Multiple entries
  - Audit log recording and ID uniqueness
  - Error status in audit log
  - Audit log reset
  - Test helper functions
  - Custom pluggable source
  - Unavailable custom source

- **`routes-d/tests/payments.screen.test.ts`** — Route integration tests (8 tests) covering:
  - Successful clean response (200)
  - Sanctions hit rejection (403 `SANCTIONS_HIT`)
  - Source unavailable (503 `SCREENING_UNAVAILABLE`)
  - Missing authentication (401 `UNAUTHORIZED`)
  - Missing destination (400 `INVALID_DESTINATION`)
  - Non-string destination (400)
  - Whitespace trimming
  - Audit log integration

## Testing

Unit and integration tests follow the existing routes-d pattern (`supertest` + `express`, `buildApp()`, `beforeEach` reset).

```bash
npm test -- routes-d/tests/unit/sanctionsScreening.test.ts routes-d/tests/payments.screen.test.ts
```

closes #387
