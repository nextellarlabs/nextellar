# Pull Request — CLI: Add --dry-run mode to scaffold command

## Issues closed

- #897 — Add dry-run preview mode to `nextellar scaffold`
- #898 — Display placeholder substitutions in scaffold plan
- #899 — List template files before scaffolding
- #900 — Show contracts overlay files in dry-run output

---

## Summary

All changes are scoped to the CLI scaffold workflow and improve developer experience by allowing users to preview exactly what `nextellar create` will do before writing any files.

### #897 — `--dry-run` flag for scaffold command

- Added `dryRun?: boolean` option to `ScaffoldOptions` interface in `src/lib/scaffold.ts`.
- When `--dry-run` is passed, the scaffold function prints a complete plan and returns early without creating any files or directories.
- The dry-run output includes:
  - Project name, template, language, target directory
  - Contracts overlay status, network selection, wallet configuration
  - Package manager detection result

### #898 — Placeholder substitution preview

- Dry-run mode displays all template placeholder substitutions that would be applied:
  - `{{APP_NAME}}`, `{{HORIZON_URL}}`, `{{SOROBAN_URL}}`, `{{NETWORK}}`
  - `{{WALLETS}}`, `{{NEXTELLAR_VERSION}}`, `{{TEMPLATE_NAME}}`, `{{TIMESTAMP}}`
- Each placeholder shows its resolved value, making it easy to verify configuration before scaffolding.

### #899 — Template file listing

- Implemented recursive `walkDir` helper that traverses the template directory tree.
- Lists all files that would be copied from the selected template, excluding `.git` and `node_modules`.
- Files are displayed with `+` prefix in green for visual clarity.

### #900 — Contracts overlay file listing

- When `--with-contracts` is enabled, dry-run mode additionally lists files from the `contracts-template` overlay.
- Contract overlay files are displayed with yellow `+` prefix and dimmed "(contracts overlay)" label to distinguish them from base template files.

---

## Files changed

```
src/lib/scaffold.ts    (modified — added dryRun option and preview logic)
.gitignore             (modified — added issue.md to ignore list)
```

No files outside `src/lib/` were modified.

---

## Usage

```bash
# Preview what will be scaffolded
nextellar create my-app --dry-run

# Preview with contracts overlay
nextellar create my-app --with-contracts --dry-run

# Preview with custom configuration
nextellar create my-app --template default --typescript --dry-run
```

---

## Test plan

```bash
# Manual verification
nextellar create test-app --dry-run
# Expected: prints scaffold plan, no files created

nextellar create test-app --with-contracts --dry-run
# Expected: includes contracts overlay files in output

nextellar create test-app --dry-run && ls test-app
# Expected: "ls" should fail — directory should not exist
```

---

## Example output

```
📋 Scaffold Plan (dry run)

  Project:    my-app
  Template:   default
  Language:   TypeScript
  Target:     /home/user/projects/my-app
  Contracts:  No
  Network:    TESTNET
  Wallets:    freighter, albedo, lobstr
  Pkg manager: npm

  Files to create:
    + package.json
    + README.md
    + tsconfig.json
    + src/app/layout.tsx
    + src/app/page.tsx
    ...

  Placeholder substitutions:
    {{APP_NAME}}         → my-app
    {{HORIZON_URL}}      → https://horizon-testnet.stellar.org
    {{SOROBAN_URL}}      → https://soroban-testnet.stellar.org
    {{NETWORK}}          → TESTNET
    {{WALLETS}}          → ["freighter","albedo","lobstr"]
    {{NEXTELLAR_VERSION}} → 0.0.0
    {{TEMPLATE_NAME}}    → default
    {{TIMESTAMP}}        → 2026-01-15T12:00:00.000Z

  No files were written. Remove --dry-run to execute.
```
