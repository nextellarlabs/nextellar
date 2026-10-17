# Mutation testing pilot (`src/lib`)

Line and branch coverage (see `jest.config.mjs`, #936/#960) tell us which
code ran during the tests, not whether a test would notice if that code were
wrong. Mutation testing does: [Stryker](https://stryker-mutator.io/) makes
small changes ("mutants") to `src/lib/**/*.ts` (flip a condition, drop a
statement, change a literal), reruns the related Jest tests, and records
whether any test failed. A mutant that survives points at a missing or
too-weak assertion. Tautological tests, for example, show up as files with
high coverage and a low mutation score.

This is a **pilot** (#1088): it produces a report and a baseline, and it does
**not** gate CI.

## Running it

```bash
npm run test:mutation          # runs Stryker (fetched with npx, no new devDependencies)
npm run mutation:score         # per-file + total score, compared with the baseline
```

- Config: `stryker.config.mjs` (Jest runner, native ESM node args,
  `mutate: src/lib/**/*.ts`, `findRelatedTests` so each mutant only runs the
  tests that import the mutated file).
- Reports: `reports/mutation/mutation.html` (open in a browser) and
  `reports/mutation/mutation.json`. `reports/` is gitignored.
- Incremental: `reports/mutation/stryker-incremental.json` lets reruns skip
  unchanged mutants.
- CI: `.github/workflows/mutation.yml` runs weekly and on manual dispatch,
  uploads the report as the `mutation-report` artifact, and writes the score
  table to the job summary. It is report-only.

Stryker is pulled with `npx -p @stryker-mutator/core@9 -p
@stryker-mutator/jest-runner@9` instead of being added to `devDependencies`,
so the pilot doesn't change `package-lock.json` or slow down `npm ci` for every
other job. If the pilot graduates to a CI gate, move both packages into
`devDependencies`.

## Score and baseline

Score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage),
which is Stryker's own definition. Compile and runtime errors, ignored and
pending mutants are excluded.

The baseline lives in [`docs/mutation-baseline.json`](./mutation-baseline.json):
the overall score plus one score per `src/lib` file, with the date it was
recorded. To record or refresh it:

```bash
npm run test:mutation
npm run mutation:score -- --write-baseline
```

Commit the updated `docs/mutation-baseline.json` with the PR that changes it.
Refresh the baseline deliberately, alongside real test improvements, the same
way the coverage floor is raised.

`npm run mutation:score -- --check` exits non-zero when the score drops more
than 1 point below the baseline (`--tolerance <points>` changes that). The
scheduled workflow does not pass `--check` yet. Add it when the team decides
to gate on the score.

## Reading the report

Start with the files that have the lowest score and the most `Survived`
mutants. In the HTML report each surviving mutant shows the exact change that
no test caught. The usual fix is an assertion on the value or branch that
changed, not another test that only executes the line.

## Known limitations

- `coverageAnalysis` is `off`: per-test coverage relies on instrumenting the
  Jest environment, which is unreliable under the suite's native ESM mode.
  `findRelatedTests` keeps the run tractable.
- A full run takes far longer than `npm test`, which is why it is weekly and
  on demand rather than per PR.
