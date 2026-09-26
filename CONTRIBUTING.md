# Contributing to Nextellar

Thanks for helping build Nextellar! This guide takes a newcomer from
`git clone` to a green test suite and a merged pull request using **only**
this document.

If you are new, start at **[Repo Map](#repo-map)** and **[The Dev Loop](#the-dev-loop)**.

---

## Getting Started

New contributor? Start with a good first issue:
- Browse good first issues at https://github.com/nextellarlabs/nextellar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22
- These are self-contained, verified-against-the-code tasks with acceptance criteria.

---

## Repo Map

Nextellar is a monorepo. The CLI (`bin/`, `src/lib/`) scaffolds runnable
Next.js + Stellar apps from the templates under `src/templates/`.

| Path | What lives here |
| --- | --- |
| `bin/` | CLI entrypoints and generators (`nextellar.ts`, `generate-soroban-bindings.ts`). |
| `src/lib/` | Shared library code used by the CLI (scaffolding, validation, telemetry). |
| `src/mocks/` | Mock Horizon / wallet / SDK servers and handlers used by the test suite. |
| `src/templates/` | Scaffolded-app templates: `default`, `defi`, `js-template`, `js-defi`, `minimal`, `auth`. Each has its own `src/components`, `src/hooks`, and `.storybook`. |
| `tests/` | Jest tests — unit (`*.test.ts`), component (`*.test.tsx`), smoke, and `e2e/`. |
| `docs/` | Documentation markdown (telemetry, bundle budgets, component reference, audits). |
| `.github/` | CI workflows, the path-based labeler config, and Dependabot config. |
| `backend/`, `routes-d/` | Optional backend services shipped alongside some templates. |
| `scripts/` | Build/analysis helpers (bundle analysis, pack-size guard, pack verification). |

> Rule of thumb: change **template** behavior in `src/templates/<name>/...`,
> change **CLI** behavior in `bin/` + `src/lib/`, and put **tests** next to
> the code they cover under `tests/`.

---

## The Dev Loop

After forking and cloning your fork:

```bash
# 1. Install dependencies (also wires up the Husky pre-commit hook)
npm install

# 2. Build the CLI / library
npm run build

# 3. Run the test suite (ESM — uses --experimental-vm-modules under the hood)
npm test

# 4. Lint and format-check the source
npm run lint
npm run format:check

# 5. Run the CLI locally against your changes
npm start
```

## Accessibility (a11y) Testing

`tests/accessibility.test.tsx` and `tests/accessibility.mocked-wallet.test.tsx` run
`jest-axe` against real, rendered markup for the `default` template's components
(see `docs/accessibility-audit.md` for the full manual audit these automate a subset
of). These are ordinary Jest test files matched by `jest.config.mjs`'s `testMatch`,
so **`npm test` already runs them, and a `toHaveNoViolations()` failure fails the
suite like any other test** — no separate a11y-specific CI job exists or is needed.

In CI, the `Coverage threshold gate` job in `.github/workflows/ci.yml` runs
`npm test -- --coverage` on every PR and blocks the merge on any test failure,
including an axe violation in these two files. If you add or change a component
under `src/templates/default/src/components/`, run `npm test` locally before
pushing to catch a violation before CI does.

When adding a new component (or a new interactive state to an existing one) that
belongs in this coverage, add a case to whichever of the two files matches its
testing style:
- `tests/accessibility.test.tsx` — uses `./helpers`'s Context-Provider-based
  `render(el, { wallet })`. Use this for most components.
- `tests/accessibility.mocked-wallet.test.tsx` — uses
  `jest.unstable_mockModule` to make `useWallet()`/`useStellarBalances()` real
  `jest.fn()`s with per-test `mockReturnValue` control. Use this only when a
  component's test genuinely needs that (e.g. asserting the hook was called with
  specific arguments) — do **not** import from `./helpers` in this file, since
  `./helpers` statically imports the real `src/mocks/wallet-contexts-mock` and
  that import happens (per the ES module spec) before any
  `jest.unstable_mockModule` call in the same file could intercept it, silently
  making the mock never take effect.