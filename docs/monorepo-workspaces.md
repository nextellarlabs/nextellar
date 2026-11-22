# Scaffolding into a Monorepo / Workspace

By default `nextellar my-app` creates a standalone project in `./my-app`.
With `--workspace` (or `--workspace-root <dir>`) it instead adds the app as a
package of an **existing** npm, yarn, pnpm or bun workspace, including
Turborepo setups.

```sh
# From anywhere inside the monorepo: finds the nearest workspace root
nextellar web --workspace

# Point at a workspace root explicitly
nextellar web --workspace-root ../my-monorepo

# Choose the exact location (relative to the workspace root)
nextellar services/dapp --workspace
```

## What workspace mode does

| Step | Standalone (default) | `--workspace` |
| --- | --- | --- |
| Target directory | `./<name>` | `<root>/apps/<name>` for a bare name (or `packages/<name>`, see below); `<root>/<path>` for a path |
| `package.json` `name` | the project name | the last path segment (`services/dapp` -> `dapp`) |
| Package manager | flag, user agent, or lockfile in the new app | always the workspace's own (see below) |
| Lockfile | template's `package-lock.json` kept | removed; the root lockfile is the only one |
| Workspace config | n/a | the app path is appended when no existing glob covers it |
| Install | runs in the new app | runs once from the workspace root, so the app is linked |
| `git init` | yes (unless `--no-git`) | skipped; the monorepo already owns the repository |

### Finding the workspace root

A directory is a workspace root when it has either:

- a `package.json` with a `workspaces` field (an array, or yarn's
  `{ "packages": [...] }` object form), or
- a `pnpm-workspace.yaml` with a `packages:` list.

`--workspace` walks up from the current directory to the nearest such root.
If none is found the command fails before writing any files.

### Package manager

The workspace's package manager is used, detected in this order:

1. the root `package.json` `packageManager` field (e.g. `"pnpm@9.12.0"`),
2. the root lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`,
   `package-lock.json`),
3. `pnpm` when a `pnpm-workspace.yaml` exists, otherwise `npm`.

Passing a different `--package-manager` is an error (a workspace has exactly
one); omit the flag or pass the matching one. The interactive prompt does not
ask for a package manager in workspace mode.

### Where a bare name goes

`nextellar web --workspace` uses `apps/` when the workspace declares `apps/*`,
otherwise `packages/` when it declares `packages/*`, otherwise the folder of the
first single-level glob, falling back to `apps/`. Pass a path
(`nextellar tools/explorer --workspace`) to choose the location yourself; a path
that is absolute or escapes the root is rejected.

## Examples

### npm workspaces

```jsonc
// package.json (root)
{ "private": true, "workspaces": ["apps/*", "packages/*"] }
```

```sh
nextellar web --workspace
npm run dev --workspace web
```

### yarn workspaces

```jsonc
// package.json (root)
{ "private": true, "workspaces": { "packages": ["packages/*"] }, "packageManager": "yarn@4.5.0" }
```

```sh
nextellar dapp --workspace      # -> packages/dapp, installed with yarn
yarn workspace dapp dev
```

### pnpm workspaces

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
```

```sh
nextellar services/dapp --workspace   # not covered by apps/*, so "services/dapp" is added
pnpm --filter dapp dev
```

### Turborepo

Turborepo uses the package manager's workspaces, so nothing extra is needed:
the new app is picked up by `turbo run dev` / `turbo run build` through its
`dev`/`build` scripts. The CLI reports `(Turborepo)` when it finds a
`turbo.json` at the root.

```sh
nextellar web --workspace
npx turbo run dev --filter=web
```

