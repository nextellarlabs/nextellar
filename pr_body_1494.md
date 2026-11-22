## Summary
Closes #1494.

Adds a `--with-ci` CLI flag to project scaffolding that generates a customized, production-ready GitHub Actions CI workflow (`.github/workflows/ci.yml`) tailored to the selected package manager (`npm`, `yarn`, `pnpm`, or `bun`).

## Changes Included
1. **CI Generator (`src/lib/ci.ts`)**:
   - `generateCiWorkflow(packageManager)`: Generates a GitHub Actions workflow with lint, type-check, test, and build steps.
   - Tailored caching and toolchains:
     - `npm`: Uses `actions/setup-node@v4` with `cache: npm` and `npm ci`.
     - `yarn`: Uses `actions/setup-node@v4` with `cache: yarn` and `yarn install --frozen-lockfile`.
     - `pnpm`: Uses `pnpm/action-setup@v3` + `cache: pnpm`.
     - `bun`: Uses `oven-sh/setup-bun@v2` with `bun install --frozen-lockfile`.
2. **CLI Option (`bin/nextellar.ts`)**:
   - Registered `--with-ci` flag ("generate a GitHub Actions CI workflow in the created project").
   - Passed down to `scaffold()`.
3. **Scaffolding Integration (`src/lib/scaffold.ts`)**:
   - When `withCi` is true, writes `.github/workflows/ci.yml` in the generated project.
   - Shows `.github/workflows/ci.yml` in dry-run mode (`--dry-run`).
4. **README Update (`README.md`)**:
   - Added `--with-ci` option documentation in CLI usage.
5. **Unit & Scaffold Tests (`tests/scaffold-with-ci.test.ts`)**:
   - Tests generating workflows across all package managers.
   - Tests end-to-end scaffolding with `withCi: true`.

## Verification
- Validated YAML output across npm, yarn, pnpm, and bun.
- Clean git diff with standard conventions.

### Verified Contributor Addresses:
- **Base / EVM (USDC)**: `0x53Eb00b639e3e7fD2E55faB322495d4371faB65a`
- **TRAC**: `trac1sfu7tt3nnlayu27u7hw7chhu4ctzesle3rp8lnqeu3e2ccux3pus8hckea`
- **BCH**: `bitcoincash:qr9gjzwkvghvvdyvqg8pppcvsg084pgeyvjyx3hjjc`
