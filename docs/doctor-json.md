# `nextellar doctor --json` output schema

The `--json` flag is intended for CI pipelines. Its output shape is a versioned contract.

```
nextellar doctor --json
```

## Top-level fields

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `number` | Schema version — currently `2`. Increment when the shape changes in a breaking way. |
| `horizonUrl` | `string` | Resolved Horizon endpoint that was probed (from `--horizon-url`, project config, or the testnet default). |
| `sorobanUrl` | `string` | Resolved Soroban RPC endpoint that was probed (from `--soroban-url`, project config, or the testnet default). |
| `checks` | `CheckResult[]` | One entry per diagnostic check. |
| `passed` | `number` | Number of checks where `ok` is `true`. |
| `failed` | `number` | Number of checks where `ok` is `false`. |
| `requiredFailures` | `number` | Number of checks where both `required` and `!ok` are true. |

**Exit code:** `0` when `requiredFailures === 0`, otherwise `1`.

## `CheckResult` fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Machine-readable identifier (e.g. `"node"`, `"git"`). |
| `name` | `string` | ✅ | Human-readable label. |
| `required` | `boolean` | ✅ | Whether this check must pass for the project to function. |
| `ok` | `boolean` | ✅ | `true` if the check passed. |
| `detail` | `string` | optional | Extra context (detected version, error message, etc.). |
| `fix` | `string` | optional | Short remediation hint. |
| `link` | `string` | optional | URL to installation docs or further reading. |

## Example output

```json
{
  "schemaVersion": 2,
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "sorobanUrl": "https://soroban-testnet.stellar.org",
  "checks": [
    {
      "id": "node",
      "name": "Node.js",
      "required": true,
      "ok": true,
      "detail": "v20.11.0 (>= 20.0.0 required)",
      "fix": "Install Node.js >= 20: https://nodejs.org/",
      "link": "https://nodejs.org/"
    }
  ],
  "passed": 1,
  "failed": 0,
  "requiredFailures": 0
}
```

## CI usage

```bash
nextellar doctor --json | jq '.requiredFailures == 0'
```

Or rely on the exit code directly:

```bash
nextellar doctor --json
# exits 0 on success, 1 if any required check failed
```

## Versioning

Consumers should guard on `schemaVersion`. A bump indicates a breaking change (field removed or renamed). New optional fields may be added at any schema version without a bump.

## Tests backing this contract

Two test files guard this contract from opposite directions:

- `tests/doctor-json.test.ts` — a **shape** test. It runs `doctor --json` against
  whatever toolchain happens to be on the machine running the test and asserts
  the *structure* holds: exact top-level key set, exact `CheckResult` key set,
  correct field types, and the derived-field invariants (`passed + failed ===
  checks.length`, `requiredFailures` matches the check data).
- `tests/doctor-json-golden.test.ts` — a **golden** test. It stubs every
  environment-dependent check (subprocess version checks, free RAM, network
  reachability) via `setCommandRunnerForTest` / `setFreeMemoryProviderForTest`
  and a mocked `fetch` to produce a fully deterministic, healthy-toolchain
  run, then diffs the resulting JSON byte-for-byte against the checked-in
  fixture at `tests/__fixtures__/doctor-json-v2.golden.json`.

The shape test alone can't catch every regression — e.g. a `detail` string's
wording changing, or a field's value format shifting — without breaking on
every developer's differently-configured machine. The golden test closes that
gap: because the toolchain is fully mocked, the output is identical on any
machine and in CI, so any change to the JSON body (not just its shape) makes
the golden test fail until the fixture is deliberately updated. That forced,
explicit update is what prevents this documented contract from drifting out
from under CI consumers silently.

To intentionally update the fixture after a deliberate change to `runDoctor`'s
JSON output, update `src/lib/doctor.ts` and this doc together, then run:

```bash
UPDATE_DOCTOR_GOLDEN=1 npx jest tests/doctor-json-golden.test.ts
```

and review the resulting diff to `tests/__fixtures__/doctor-json-v2.golden.json`
before committing it. If the change is breaking (a field renamed or removed),
bump `DOCTOR_JSON_SCHEMA_VERSION` per the versioning policy above.
