# E2E Tests

End-to-end tests that validate the complete scaffolding workflow including installation and build steps.

## Why E2E Tests are Gated

E2E tests are **SKIPPED BY DEFAULT** because they:
- Take 2-5 minutes to run (full npm install + build cycle)
- Require network access for package installation
- Are resource-intensive
- Would slow down the normal development workflow

The normal `npm test` command runs unit and integration tests only (fast, no network required).

## Running E2E Tests

### Run all E2E tests:

```bash
NEXTELLAR_E2E=1 npm test -- tests/e2e
```

### Run a specific E2E test:

```bash
NEXTELLAR_E2E=1 npm test -- tests/e2e/scaffold-default.e2e.test.ts
```

### Windows (CMD):

```cmd
set NEXTELLAR_E2E=1 && npm test -- tests/e2e/scaffold-default.e2e.test.ts
```

### Windows (PowerShell):

```powershell
$env:NEXTELLAR_E2E="1"; npm test -- tests/e2e/scaffold-default.e2e.test.ts
```

## Available E2E Tests

### `scaffold-default.e2e.test.ts`

Validates the core product promise: scaffolded apps are production-ready.

**What it tests:**
- Scaffolds the default TypeScript template
- Runs `npm install` 
- Verifies no `{{PLACEHOLDER}}` syntax remains in generated files
- Verifies `.env.example` exists and is populated
- Verifies `.nextellar/config.json` exists (if present in template)
- Runs `next build` and asserts exit code 0
- Verifies `.next` build artifacts are created

**Requirements:**
- Node.js 20+ (matches package.json engine requirement)
- npm installed and in PATH
- ~2-3 minutes execution time
- ~500MB disk space for temp scaffolded app

**Expected output on success:**
```
PASS tests/e2e/scaffold-default.e2e.test.ts
  E2E: scaffold + install + build (default template)
    ✓ scaffold default template with install enabled
    ✓ verify .env.example exists and has no placeholders
    ✓ verify .nextellar/config.json exists and has no placeholders
    ✓ verify all {{PLACEHOLDER}} substitutions are resolved
    ✓ verify node_modules exists (install succeeded)
    ✓ run next build and verify exit code 0
```

**Expected output when skipped (normal test run):**
```
SKIP tests/e2e/scaffold-default.e2e.test.ts
  E2E: scaffold + install + build (default template)
    ○ skipped (E2E tests require NEXTELLAR_E2E=1)
```

## CI Integration

These tests can be integrated into CI pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run E2E Tests
  run: |
    export NEXTELLAR_E2E=1
    npm test -- tests/e2e
  env:
    CI: true
```

## Troubleshooting

### Build fails with TypeScript errors

Check the build output in the test failure message. The test captures and displays:
- Build stdout
- Build stderr  
- Error details

The scaffolded app directory is cleaned up after the test, but you can comment out the `afterAll` cleanup to inspect the generated files.

### Test times out

The test has a 5-minute timeout. If it consistently times out:
- Check network connection (npm install requires network)
- Check available disk space
- Consider increasing the timeout in the test file

### Unresolved placeholders found

If the test fails with unresolved `{{PLACEHOLDER}}` syntax:
1. Check which file contains the placeholder (logged in test output)
2. Verify the file is in `filesToProcess` array in `src/lib/scaffold.ts`
3. Verify the placeholder key exists in the `config` object in `src/lib/scaffold.ts`

## Future E2E Tests

Additional E2E tests can be added for:
- `scaffold-minimal.e2e.test.ts` - Test minimal template
- `scaffold-defi.e2e.test.ts` - Test DeFi template
- `scaffold-js.e2e.test.ts` - Test JavaScript template
- `scaffold-with-contracts.e2e.test.ts` - Test with `--contracts` flag
