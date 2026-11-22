# Visual regression testing (template components)

Unit and smoke tests check that template components render and behave. They
don't notice a broken layout, a lost dark-mode colour or a misaligned button.
The visual regression check (#1083) screenshots every Storybook story of the
**`default` template's components** and compares each one with a committed
baseline image.

## How it works

1. CI scaffolds a `default` app (`nextellar vr-app --template default`), installs
   it and runs its own `npm run build-storybook`, so the screenshots reflect
   what users actually get.
2. `scripts/visual-regression.mjs` serves `storybook-static/`, reads its
   `index.json`, and opens each story under `./src/components/` in
   headless Chromium through Playwright (already a devDependency) at
   1024x768, light colour scheme, with animations and transitions disabled.
3. Each full-page screenshot is compared with
   `tests/visual/__screenshots__/default/<story-id>.png` on a canvas in the
   same browser. A pixel counts as changed when any RGBA channel differs by
   more than 16. A story fails when more than 0.1% of its pixels changed, or
   when the image size changed.
4. Results go to `reports/visual/` (`actual/`, `diff/` with changed pixels in
   red, `summary.json`), uploaded as the `visual-regression` artifact, plus a
   table in the job summary.

The pass/fail and story-selection rules live in
`scripts/lib/visual-regression.js` and are unit tested in
`tests/visual-regression.test.ts`.

## Baselines

A story with no baseline is reported as **new** and does **not** fail the job,
so the check can be added before every baseline exists. Pass
`--fail-on-missing` to make missing baselines fail.

Record baselines on Linux so font rendering matches the CI runner. The easiest
way is to download the `visual-regression` artifact from a CI run and copy
`actual/*.png` into `tests/visual/__screenshots__/default/`. Or run it locally
inside the Playwright image:

```bash
node dist/bin/nextellar.js vr-app --defaults --skip-install --template default
(cd vr-app && npm install && npm run build-storybook)
npm run test:visual -- --storybook-dir vr-app/storybook-static --update
```

When a change is intentional, update the affected PNGs in the same PR and
check the `diff/` images in review.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--storybook-dir <dir>` | required | Static Storybook build to test |
| `--baseline-dir <dir>` | `tests/visual/__screenshots__/default` | Baseline PNGs |
| `--out-dir <dir>` | `reports/visual` | Actual/diff PNGs and `summary.json` |
| `--max-diff-ratio <n>` | `0.001` | Max fraction of changed pixels |
| `--update` | off | Write every capture as the new baseline |
| `--fail-on-missing` | off | Fail on stories without a baseline |

To leave out a story that can't be made deterministic (live data, random
values), add the `skip-visual` tag to it in its `*.stories.tsx`.

## Scope

Only the `default` template's components are covered for now. Other templates
share most components with `default`, and adding them later means another
scaffold/build step in the CI job plus another baseline folder.
