# Config Migration Guide

Every scaffolded project has a `.nextellar/config.json` file that records how the project was created and what the `nextellar upgrade` command uses to reconcile a project against a newer CLI/template release. This guide covers the file's current shape and exactly what `nextellar upgrade` does (and does not) do to it today.

---

## Current schema (v1)

```json
{
  "schemaVersion": 1,
  "nextellarVersion": "0.4.2",
  "template": "default",
  "createdAt": "2026-01-15T10:32:00.000Z"
}
```

| Field              | Type   | Meaning                                                                 |
| ------------------ | ------ | ------------------------------------------------------------------------ |
| `schemaVersion`    | number | Shape of this file. `nextellar` refuses to touch a file with a higher version than it understands. |
| `nextellarVersion` | string | The `nextellar` CLI version that scaffolded (or last upgraded) this project. |
| `template`         | string | Which template was scaffolded (`default`, `minimal`, `defi`, `js-template`, `js-defi`). |
| `createdAt`        | string | ISO 8601 timestamp of when the project was scaffolded.                  |

Other keys (for example `horizonUrl`, `sorobanUrl` and `wallets` written by `nextellar init`) are allowed and always preserved.

## What `nextellar upgrade` does

Running `npx nextellar upgrade` in a scaffolded project:

1. Reads `.nextellar/config.json` and **migrates it to the current schema** if needed (see below). An unreadable file is an error; it is no longer treated as empty.
2. Compares the project's `nextellarVersion` against the installed CLI version. It refuses to proceed (unless `--yes` is passed) if the installed CLI is older than the project, because upgrading would downgrade project files.
3. Diffs the project's `src/hooks` and `src/lib` files against the current version of the matching template, and reports files that are new or changed upstream.
4. Diffs `package.json` for the Stellar-related dependencies (`@stellar/stellar-sdk`, `@creit.tech/stellar-wallets-kit`) against the template's current versions.
5. Prints a summary of what would change, including each config migration step. Pass `--dry-run` to preview only, or omit it to apply the changes.

After applying changes, `upgrade` writes `nextellarVersion` (the CLI version that just ran) and `updatedAt`. If only the config needed migrating, it writes the migrated config and nothing else.

## Migrating between schema versions

Implemented by `migrateProjectConfig()` in `src/lib/project-config.ts` (#907).

### v0 (unversioned) → v1

Every project scaffolded before `schemaVersion` existed is treated as v0. The migration:

| Step | Detail |
| ---- | ------ |
| Add `schemaVersion: 1` | |
| Fill `nextellarVersion` | from legacy `version` or `cliVersion`, otherwise `"unknown"` |
| Fill `template` | from legacy `templateName` or `templateId`, otherwise `"default"` |
| Fill `createdAt` | from legacy `created`, `created_at` or `createdOn`. Epoch seconds or milliseconds are converted to ISO 8601. If nothing usable is found, the config file's last-modified time is used. |
| Convert `wallets` | a comma-separated string such as `"freighter, albedo"` becomes `["freighter", "albedo"]` |

Guarantees:

- **Lossless:** legacy keys and unknown keys are kept, never deleted.
- **Idempotent:** a migrated (or already current) file migrates to itself. A valid `createdAt` string is kept exactly as written, so current files are never rewritten.
- **Safe on preview:** `--dry-run` and `--check` show the migration but never write it.
- **No silent downgrades:** a file with a `schemaVersion` newer than the CLI understands stops the upgrade with an error asking you to update `nextellar`.

An incomplete v1 file (for example one hand-edited, or a legacy file that `nextellar init` stamped with `schemaVersion: 1` without the other fields) is repaired the same way.

Example output:

```text
Legacy .nextellar/config.json (schema v0) will be migrated to v1:
 - schemaVersion: 0 -> 1
 - template: copied from legacy "templateName"
 - createdAt: copied from legacy "created"
...
Migrated .nextellar/config.json to schema v1
```

## If your project predates this guide

Run `npx nextellar upgrade --dry-run` to see what the migration would change, then `npx nextellar upgrade` to apply it. Nothing needs to be edited by hand. If `nextellar upgrade` reports `.nextellar/config.json` is missing entirely, the project was not created by `nextellar create` (or the file was deleted). Recreate it with the four fields above, using your project's actual template name and the CLI version you're currently running.
