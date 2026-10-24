# Branch Protection and Required Status Checks

## Evidence

### Branch Protection Status

Branch protection is enabled but with no required status checks configured:

```json
"protected": true,
"protection": {
  "enabled": false,
  "required_status_checks": {
    "enforcement_level": "off",
    "contexts": [],
    "checks": []
  }
}
```

Source: `curl -s https://api.github.com/repos/nextellarlabs/nextellar/branches/main`

### CI Runs on PRs

CI workflow runs on pull_request events. The following executed runs (conclusion is failure or success, not action_required) were found:

No executed pull_request CI runs with success or failure conclusion were found in the last 10 runs. The most recent runs show:
- Run #324: action_required (first-time contributor approval)
- Run #323: failure - https://github.com/nextellarlabs/nextellar/actions/runs/38975494574
- Run #322: failure - https://github.com/nextellarlabs/nextellar/actions/runs/38915156795
- Run #321: action_required (first-time contributor approval)
- Run #320: failure - https://github.com/nextellarlabs/nextellar/actions/runs/38892597778
- Run #319: failure - https://github.com/nextellarlabs/nextellar/actions/runs/38879599905
- Run #318: failure (push to main, not PR)

Note: First-time contributor "Action required" is a separate GitHub repository setting that must be approved by a maintainer before workflows run.

### Failed-Then-Merged PRs

The following PRs had CI failures but were merged:

- **PR #1194**: feat: add SEP-24 interactive flow, multi-sig builder, Ledger and WalletConnect adapters
  - CI run #323 failed: https://github.com/nextellarlabs/nextellar/actions/runs/38975494574
  - Merged at: 2026-10-17T07:13:32Z

- **PR #1191**: feat: full template, upgrade --diff, mutation testing pilot, visual regression
  - CI run #320 failed: https://github.com/nextellarlabs/nextellar/actions/runs/38892597778
  - Merged at: 2026-10-17T07:12:18Z

- **PR #1190**: fix(a11y): skeleton loading announcements, contract form field errors, reduced-motion theme toggle, keyboard network selection
  - CI run #319 failed: https://github.com/nextellarlabs/nextellar/actions/runs/38879599905
  - Merged at: 2026-10-17T07:10:54Z

- **PR #1189**: Fix doctor URL validation and documentation
  - CI run #318 failed (push to main): https://github.com/nextellarlabs/nextellar/actions/runs/38769340468
  - Merged at: 2026-10-17T07:14:13Z

This confirms that CI does not gate merges because required status checks are not configured.

## Verified Required Check Names

The following job names from `.github/workflows/ci.yml` should be configured as required status checks:

1. Lint and format
2. Coverage threshold gate
3. Build and verify package
4. E2E — default scaffold + next build
5. E2E — minimal scaffold + next build
6. npm pack size guard
7. Lighthouse CI — default scaffold
8. Visual regression — default template Storybook

Note: "Test coverage report" is informational only (posts a PR comment) and should NOT be required.

These job names were verified by fetching jobs from a recent CI run (run #328, push to main):
```bash
curl -s "https://api.github.com/repos/nextellarlabs/nextellar/actions/runs/39012880151/jobs"
```

All jobs in ci.yml have no `if:` conditions or path filters, so they all run on every PR.

## How to Configure Required Status Checks

### Via GitHub Web UI

1. Navigate to: https://github.com/nextellarlabs/nextellar/settings/branches
2. Click "Add branch protection rule" or edit the existing rule for `main`
3. Configure:
   - **Branch name pattern**: `main`
   - **Require status checks to pass before merging**: ✅ Enable
   - **Require branches to be up to date before merging**: ✅ Enable (strict mode)
   - **Required status checks**: Add the following:
     - Lint and format
     - Coverage threshold gate
     - Build and verify package
     - E2E — default scaffold + next build
     - E2E — minimal scaffold + next build
     - npm pack size guard
     - Lighthouse CI — default scaffold
     - Visual regression — default template Storybook
4. Save the rule

### Via GitHub CLI (for maintainers with admin rights)

A script is provided at `scripts/apply-branch-protection.sh` that uses the GitHub CLI to apply the required status checks.

## Notes

- **First-time contributor approval**: The "Action required" status on runs #324 and #321 is due to GitHub's first-time contributor approval setting, which is separate from branch protection. A maintainer must approve the workflow before it can run.
- **CI runtime**: Run #323 took approximately 8 hours 49 minutes to complete. Consider adding `timeout-minutes` to jobs in a follow-up issue to prevent excessively long runs.
- **All jobs run**: All 8 jobs in ci.yml have no conditional execution (no `if:` conditions or path filters), so they all run on every PR to main.
