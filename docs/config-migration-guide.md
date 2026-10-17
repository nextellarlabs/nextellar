# Config Migration Guide

Every scaffolded project has a `.nextellar/config.json` file that records how the project was created and what the `nextellar upgrade` command uses to reconcile a project against a newer CLI/template release. This guide covers the file's current shape and exactly what `nextellar upgrade` does (and does not) do to it today.

---

## Current schema (v1, unversioned)

```json
{
  "nextellarVersion": "0.4.2",
  "template": "default",
  "createdAt": "2026-01-15T10:32:00.000Z"
}
```

| Field              | Type   | Meaning                                                                 |
| ------------------ | ------ | ------------------------------------------------------------------------ |
| `nextellarVersion` | string | The `nextellar` CLI version that scaffolded (or last upgraded) this project. |
| `template`         | string | Which template was scaffolded (`default`, `minimal`, `defi`, `js-template`, `js-defi`). |
| `createdAt`        | string | ISO 8601 timestamp of when the project was scaffolded.                  |

There is currently no `configVersion`/`schemaVersion` field in this file — the shape above is the only shape that has ever existed, referred to here as "v1" for the purpose of this guide. `nextellar upgrade` reads `nextellarVersion` and `template` from it, but never adds, renames, or removes fields in `config.json` itself.

## What `nextellar upgrade` actually does

Running `npx nextellar upgrade` in a scaffolded project:

1. Reads `.nextellar/config.json` to determine the project's template and the CLI version it was last scaffolded/upgraded with.
2. Compares that version against the currently installed `nextellar` CLI version, and refuses to proceed (unless `--yes` is passed) if the installed CLI is older than the project — upgrading would downgrade project files.
3. Diffs the project's `src/hooks` and `src/lib` files against the current version of the matching template, reporting files that are new or changed upstream.
4. Diffs `package.json` for the Stellar-related dependencies (`@stellar/stellar-sdk`, `@creit.tech/stellar-wallets-kit`) against the template's current versions.
5. Prints a changelog summary of what would change. Pass `--dry-run` to preview only, or omit it to apply the changes.

**`config.json` itself is not migrated, rewritten, or version-bumped by any of this.** The only thing `upgrade` writes back is the `nextellarVersion` field, updated to the CLI version that just ran the upgrade, once source files have been reconciled.

## Migrating between schema versions

There is no v1 → v2 (or any other) config schema migration today, because no second schema version exists yet. If you're looking for:

- **A versioned `configVersion` field on `config.json`** — tracked in [#906](https://github.com/nextellarlabs/nextellar/issues/906).
- **Migration behavior for `nextellar upgrade` when the schema changes** — tracked in [#907](https://github.com/nextellarlabs/nextellar/issues/907).

Once a versioned schema and its first migration land, this guide's "Migrating between schema versions" section will document each version transition here: what changed, why, and what `nextellar upgrade` does automatically versus what (if anything) requires manual action in an existing project.

## If your project predates this guide

Every project scaffolded so far has the same v1 shape described above — there is nothing to manually migrate. If `nextellar upgrade` reports `.nextellar/config.json` is missing entirely, that project was not created by `nextellar create` (or the file was deleted); recreate it with the three fields listed above, using your project's actual template name and the CLI version you're currently running.
