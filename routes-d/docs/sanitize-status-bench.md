# Chizube routes-d batch — sanitize, status, bench

Three of chizube's four assigned routes-d issues. The fourth (#322 —
general input sanitizer middleware) is already on `main` as
`routes-d/middleware/sanitizer.ts` — see the PR body for the
disposition.

## Pieces

| Issue | File(s) | Purpose |
|-------|---------|---------|
| #270 | `lib/sanitize.ts`, `tests/sanitize.test.ts` | Pure helpers: `sanitizeText`, `sanitizeEmail`, `sanitizeUsername`, `collapseWhitespace`, `stripControlChars`, `sanitizeDeep`. NFC-normalize + strip BOM / zero-width / control chars. |
| #322 | (already on `main`) | Middleware version — `routes-d/middleware/sanitizer.ts` ships an opt-in `RequestHandler` with deep traversal. The lib above is the unit-testable counterpart routes can call directly. |
| #332 | `routes/status.ts`, `tests/status.test.ts` | `GET /status` fans out to caller-supplied `StatusCheck[]`, rolls up to `healthy / degraded / unreachable`, bounds each check with a per-probe timeout. |
| #314 | `tests/bench/_recorder.ts`, `tests/bench/payments-submit-profile.ts`, `tests/bench/orders-list-profile.ts`, `tests/bench.test.ts` | CSV-backed latency recorder + payment-submit and orders-list benchmarks. Auth profile already on `main`. |

## How #314 hangs together

- `_recorder.ts` exposes `summariseLatencies`, `recordRun`, `ensureCsvHeader`.
- Each profile is a self-running module: importable as a library AND
  invokable as a script (`process.argv[1]` guard at the bottom).
- CI's dedicated bench job runs the scripts; `recordRun` appends a row to
  `routes-d/tests/artifacts/bench.csv` and throws when p99 / max
  exceeds the configured budget — so the bench job fails on
  regression.
- `bench.test.ts` is the Jest companion that exercises the helpers (math
  + CSV IO) in unit mode (no `recordedAt`, no CSV write).

## Acceptance criteria mapping

- ✓ "All implementation lives under routes-d/" — every file added is
  under `routes-d/`.
- ✓ "Files compile" — routes-d has its own tsconfig with
  `./**/*.ts` glob.
- ✓ "Add unit and integration tests under routes-d/tests/" — three new
  test files: `sanitize.test.ts`, `status.test.ts`, `bench.test.ts`.
- ✓ "No regressions in CI" — no production files modified outside
  `routes-d/`.
