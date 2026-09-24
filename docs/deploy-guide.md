# Deployment Guide: the `deploy` command

The `nextellar deploy` command validates your project and bundles it into a
single gzipped tarball (a "deployment bundle") ready for Nextellar Cloud. This
guide explains how bundling works, what is excluded, how to preview a bundle
without writing anything (`--dry-run`), and the state file that records the
result of each run.

## Prerequisites

Run the command from the root of a **Next.js** project that was scaffolded (or
is compatible) with Nextellar:

- `package.json` must exist and declare a `next` dependency (in `dependencies`
  or `devDependencies`).
- A production build must already exist (the `.next` directory). Run
  `npm run build` first if it is missing — `deploy` refuses to bundle without it.

```bash
# 1. Produce a production build
npm run build

# 2. Create the deployment bundle
npx nextellar deploy
```

## What the command does

1. **Validates the project** — confirms `package.json`, the `next` dependency,
   and the presence of `.next`. If anything is missing it prints a clear error
   and exits non-zero.
2. **Detects contracts** — if a top-level `contracts/` directory exists it is
   reported as `Contracts: detected` in the summary (it is still bundled as
   regular source, not deployed by this command).
3. **Creates the bundle** — writes a gzipped tarball to
   `.nextellar/deploy/<app-name>-<timestamp>.tar.gz`.
4. **Writes the state file** — see [The state file](#the-state-file) below.
5. **Reports bundle size** — compares the bundle size against the threshold and
   warns if it is exceeded.

## Excludes

The bundle is created from the project root but deliberately skips large or
machine-specific paths so the archive stays small and portable:

| Excluded path          | Why                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| `node_modules`         | Reinstalled on the target environment via the lockfile.             |
| `.git`                 | Version control metadata is not needed for deployment.              |
| `.next/cache`          | Build cache; the compiled output under `.next` is kept.             |
| `.nextellar/deploy`    | Prevents previously created bundles from nesting inside the new one. |

Everything else in the project root (source, `.next` build output, config,
`public/`, `contracts/`, etc.) is included.

## Dry run

Pass `--dry-run` to validate the project and print exactly what *would* be
created, without writing any files:

```bash
npx nextellar deploy --dry-run
```

In dry-run mode:

- The project is still validated (so misconfigurations surface early).
- No `.nextellar/deploy` directory is created.
- The command prints the would-be bundle path and the exclude list, then exits.
- The "Nextellar Cloud is coming soon" note is still shown.

Use this in CI or pre-push checks to confirm a project is deployable without
producing artifacts.

## Bundle size threshold

```bash
npx nextellar deploy --size-threshold 104857600   # 100 MB
```

- Default threshold: **50 MB** (`52428800` bytes).
- If the resulting bundle is larger than the threshold, `deploy` prints a
  warning and suggests optimizing the build or raising the threshold. The
  bundle is still written.
- The threshold is purely advisory in this release; it does not fail the
  command.

## The state file

Every successful (non-dry-run) deploy writes a JSON manifest at:

```
.nextellar/deploy/latest-bundle.json
```

It records metadata about the most recent bundle:

```json
{
  "bundlePath": "/path/to/project/.nextellar/deploy/my-app-2026-08-29T12-30-00-000Z.tar.gz",
  "bundleSizeBytes": 18432000,
  "hasContracts": false,
  "createdAt": "2026-08-29T12:30:00.000Z"
}
```

| Field             | Meaning                                                        |
| ----------------- | ------------------------------------------------------------- |
| `bundlePath`      | Absolute path to the gzipped tarball that was created.        |
| `bundleSizeBytes` | Size of the bundle in bytes (used by the size report).        |
| `hasContracts`    | `true` when a top-level `contracts/` directory was detected.  |
| `createdAt`       | ISO-8601 timestamp of when the bundle was written.            |

This file is the source of truth for "what was last bundled" and is handy for
tooling, CI artifacts, or a subsequent upload step.

## Notes & limitations

- **Nextellar Cloud upload is not yet available.** After bundling, the command
  prints: _"Nextellar Cloud is coming soon. For now, deploy with Vercel:
  `npx vercel`."_
- The `--token` option is accepted but the authenticated upload flow is not
  implemented yet; the token is acknowledged and the coming-soon note is shown.
- Because `.nextellar/deploy` is excluded from each bundle, re-running `deploy`
  does not accumulate old bundles inside new ones — but old bundle files remain
  on disk until you remove them.

## See also

- [Network and Environment Configuration Guide](./network-environment-guide.md)
- [Soroban Contracts Overlay Guide](./soroban-contracts-overlay-guide.md)
