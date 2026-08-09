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
