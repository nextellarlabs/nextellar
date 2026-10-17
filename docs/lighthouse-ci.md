# Lighthouse CI

## Overview

The `Lighthouse CI — default scaffold` job in `.github/workflows/ci.yml` scaffolds a
real `default`-template app (the same way an end user would via `npx nextellar`),
installs and builds it for production, starts it with `npm start`, and runs
[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) against the running
server. This catches a performance/accessibility/SEO regression baked into the
template itself, before it ships to every project scaffolded from it.

## Budget

Configured in `.lighthouserc.json` at the repo root:

| Category       | Minimum score |
| -------------- | ------------: |
| Performance    |          0.80 |
| Accessibility  |          0.90 |
| Best Practices |          0.90 |
| SEO            |          0.80 |

Measured baseline (scaffolded default template, 3 runs, median):
performance 80-83, accessibility 100, best practices 100, SEO 100. The performance
threshold sits right at the measured floor deliberately — Lighthouse's performance
score has real run-to-run variance (network/CPU throttling simulation), so `numberOfRuns: 3`
in `.lighthouserc.json` takes the median across three runs rather than a single
sample, and the threshold allows for that expected variance without being so loose
it would miss a real regression.

When a legitimate change moves the score (a new heavier dependency, additional
above-the-fold content, etc.), update the threshold deliberately after confirming why
it moved — don't bump it just to silence a failing run without understanding the
cause, same principle as `docs/bundle-budgets.md`'s `BUDGETS_BYTES`.

## Running it locally

```bash
npm run build
node dist/bin/nextellar.js lhci-test-app --defaults --skip-install --template default
cd lhci-test-app
npm install
npm run build
cp ../.lighthouserc.json .lighthouserc.json
npx --yes @lhci/cli@0.15.x autorun --config=.lighthouserc.json
```

This prints a per-category score summary and a link to a temporary, publicly-hosted
full report (via Lighthouse CI's `temporary-public-storage` upload target — the same
target the CI job uses, so a link appears in that job's log too). Reports there expire
after a few days; they're for quick inspection, not permanent storage.

## Design notes / trade-offs

- **Only the `default` template is checked.** Lighthouse CI's browser-automation
  collection step is comparatively expensive (starts a real server, launches
  headless Chrome, runs the page 3 times). Running it against every template the
  way `scaffold-matrix.yml` does for build-smoke checks would multiply CI time for
  marginal signal, since the templates share most of their app-shell code. If a
  template-specific regression is ever suspected, run the local steps above against
  that template's `--template` flag manually.
- **`upload.target: temporary-public-storage`**, not a persistent Lighthouse CI
  server. Standing up and maintaining an LHCI server (or paying for a hosted one)
  is out of scope for a starter-template CLI; the temporary public storage target
  gives a shareable report link per run without that operational cost. If this
  repo ever wants historical trend tracking across commits (not just pass/fail per
  PR), that would need a real LHCI server and is a deliberate future upgrade, not
  an oversight.
- **Not run on every template variant, and not run on a nightly/scheduled basis
  like `scaffold-matrix.yml`'s full matrix.** This job runs on every PR against
  `main` (via `ci.yml`'s normal trigger), which is enough to catch a regression at
  the point it's introduced without needing a separate schedule.
