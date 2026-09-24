# Per-Template Bundle Analysis & Budgets

## Overview

Each app template (`default`, `minimal`, `defi`, `js-template`, `js-defi`) ships as the
starting point for someone else's production app, so its shipped bundle size matters —
bloat baked into the template is bloat every scaffolded project inherits. This doc
describes the analyzer that measures each template's real production bundle and the
size budget it's checked against.

## Running it

```bash
npm run analyze:bundles                  # all 5 app templates
node scripts/analyze-template-bundles.mjs --template=default   # just one
node scripts/analyze-template-bundles.mjs --json                # machine-readable output
node scripts/analyze-template-bundles.mjs --keep                # keep scratch dirs for debugging
```

For each template, the script:

1. Scaffolds it into a temp directory using the same `scaffold()` function the CLI
   itself calls (`src/lib/scaffold.ts`), with `--skip-install`.
2. Runs `npm install` and `npm run build` — a real production `next build`, Turbopack
   included, exactly what a user gets running `npx nextellar`.
3. Measures every file under the build's `.next/static` directory (client JS chunks,
   CSS, and any other static build output) and totals the bytes, split into JS and CSS.
4. Compares the total against that template's budget below and reports **PASS** or
   **FAIL**, or **SKIP** with a reason if the build itself failed.

It measures a _fresh scaffold's_ build output, not this repo's own `src/templates/`
source directly — that's the bundle an actual end user ships, which is what the budget
is meant to guard.

## Budgets

| Template      | Budget (`.next/static`) |         Measured baseline (2026-08-28) | Headroom |
| ------------- | ----------------------: | -------------------------------------: | -------: |
| `minimal`     |                 3.40 MB |                                2.27 MB |    ~1.5x |
| `default`     |                 3.45 MB |                                2.29 MB |    ~1.5x |
| `defi`        |                 3.45 MB | _(currently unmeasurable — see below)_ |        — |
| `js-template` |                 3.40 MB |                                2.28 MB |    ~1.5x |
| `js-defi`     |                 3.40 MB |                                2.28 MB |    ~1.5x |

Budgets live as constants in `scripts/analyze-template-bundles.mjs`
(`BUDGETS_BYTES`), not in this table — this table is descriptive, the script is
authoritative. They're set at roughly 1.4–1.5x the measured baseline: enough headroom
for normal dependency bumps and added features without the check being noisy, tight
enough to catch a real regression (an accidentally-unpruned dependency, a component
that stops code-splitting, etc).

When a template's bundle legitimately grows (new feature, a dependency major bump),
update `BUDGETS_BYTES` deliberately and re-measure the baseline — don't bump the
number just to silence a failing run without checking _why_ it grew first.

## Known template issues (found while building this analyzer)

Building every template in production mode (rather than just scaffolding + type-string
matching, which is all `tests/templates-perf.test.ts` previously did) surfaced several
pre-existing bugs in the checked-in template source. Two were one-line syntax slips
directly blocking any production build, so they're fixed in this PR as a necessary
unblock (see the PR description for the full list). One is not fixed here and is
called out explicitly so it isn't lost:

- **`defi` template: `next build` fails.** `src/components/CounterDemo.tsx` imports
  `CounterClient` and `CONTRACTS` from `@/lib/contracts`, but `src/lib/contracts.ts`
  doesn't exist anywhere in the `defi` template. This isn't a typo-level fix — it's a
  missing module (a Soroban contract client binding + contract ID config) that the
  Counter Demo feature depends on. Implementing it is out of scope for this PR;
  filing it as its own issue is the right next step so someone with context on the
  intended `CounterClient` shape can build it properly. Until it's fixed,
  `analyze:bundles` reports `defi` as `build-failed` (a `SKIP` row, not a budget
  failure) rather than crashing.

Run `npm run analyze:bundles` after that's fixed to get `defi`'s real baseline and
fill in the table above.

## Design notes / trade-offs

- **Full production build, not static analysis.** `@next/bundle-analyzer` (webpack
  stats) doesn't have first-class Turbopack support yet, and these templates default
  to `next build --turbopack`. Actually building each template end-to-end (like
  `.github/workflows/scaffold-matrix.yml` already does for its smoke tests) gives real
  numbers instead of an estimate, at the cost of being slower (~5-10s build + ~30-60s
  `npm install` per template). This intentionally is not wired into `ci.yml` as a
  required check yet — see below.
- **A broken build is reported, not treated as a budget failure.** If a template's
  `next build` fails outright, that's a correctness bug, not "the bundle got too big."
  Conflating the two would make a legitimate build-breakage look like a budget
  regression (and vice versa hides a real budget regression behind an unrelated build
  error). `analyze:bundles`'s human-readable exit code only reflects budget violations
  for templates that could actually be measured; build failures are called out
  separately in the report.
- **Not wired into CI as a required job in this PR.** `defi` currently cannot be
  measured (see above), so a required CI job running this today would either have to
  special-case `defi` (fragile) or block every PR on a pre-existing bug unrelated to
  the PR's own changes. Once `defi`'s `@/lib/contracts` gap is fixed, wiring
  `npm run analyze:bundles` into `scaffold-matrix.yml`'s PR-smoke job (which already
  scaffolds+builds every template) is a small follow-up — it would only need to add a
  measurement step after the existing `npm run build` step, reusing the same build
  output instead of re-scaffolding.
