# CI & Branch Protection Setup

The main CI workflow (`.github/workflows/ci.yml`) runs automatically on:

- Every pull request (`pull_request`)
- Every push to `main` (`push.branches: [main]`)
- Manual runs via the Actions tab (`workflow_dispatch`)

## Required Status Checks

The canonical branch-protection configuration for `main` is stored in `.github/branch-protection.json` and enforces the following status checks from `.github/workflows/ci.yml`:

- `CI Required Checks` (aggregator gate job)
- `Lint and format`
- `Coverage threshold gate`
- `Build and verify package`
- `Template comparison drift`

`tests/ci-branch-protection.test.ts` verifies that every context listed in `.github/branch-protection.json` matches an actual job `name:` in `.github/workflows/ci.yml` so required checks cannot silently drift.

## Applying Branch Protection to `main`

A repository administrator can wire the required status checks on `nextellarlabs/nextellar` with the GitHub CLI:

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/nextellarlabs/nextellar/branches/main/protection \
  --input .github/branch-protection.json
```

Or via the GitHub UI:

1. Go to **Settings -> Branches -> Branch protection rules** and edit (or add) the rule for `main`.
2. Enable **Require status checks to pass before merging** and **Require branches to be up to date before merging**.
3. Add the required checks listed above (at minimum `CI Required Checks`).
4. Save changes.
