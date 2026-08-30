# Contributing to Nextellar

Thanks for helping build Nextellar! This guide takes a newcomer from
`git clone` to a green test suite and a merged pull request using **only**
this document.

If you are new, start at **[Repo Map](#repo-map)** and **[The Dev Loop](#the-dev-loop)**.

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

`npm install` sets up a **pre-commit hook** (Husky + lint-staged) that runs
ESLint (`--fix`) and Prettier on staged files, so most style issues are
caught before they reach CI. It only checks staged files, so it stays fast.
If a file cannot be auto-fixed, the commit is blocked — fix it, `git add`
again, and retry.

### E2E tests (optional but recommended)

`npm test` **skips** the E2E suite by default because it performs real
`npm install` + `next build` runs (2–5 minutes each). Run them explicitly:

```bash
npm run test:e2e
```

See `tests/e2e/README.md` for details.

### CI pipeline (what must stay green)

Every PR runs the workflows in `.github/workflows/`:

| Job | Command | Purpose |
| --- | --- | --- |
| Lint & format | `npm run lint` + `npm run format:check` | Style/format gate. |
| Coverage gate | `npm test -- --coverage` | Fails the merge if coverage drops below the configured floor. |
| Build & verify | `npm run build` + `npm run verify:pack` | Ensures the package builds and contains the right files. |
| E2E (default) | scoped `tests/e2e/scaffold-default.e2e.test.ts` | Default template scaffolds and builds. |
| Pack guard | `npm run build` + `node scripts/check-pack-size.mjs` | Tarball/unpacked size thresholds. |
| Coverage report | `npm run test:coverage` | Posts a coverage summary as a PR comment. |

If your change adds or modifies behavior, add or update tests so the
coverage gate stays green.

---

## Label Taxonomy

Labels are applied automatically; you don't need to add them manually.

### Area labels (`.github/labeler.yml`, by changed path)

| Label | Applied when changes touch |
| --- | --- |
| `area:cli` | `bin/**`, `src/lib/**` |
| `area:templates` | `src/templates/**` |
| `area:backend` | `backend/**`, `routes-d/**` |
| `area:docs` | `docs/**`, `**/*.md` |
| `area:ci` | `.github/**` |
| `area:tests` | `tests/**`, `**/*.test.ts`, `**/*.test.tsx`, `**/__tests__/**` |
| `area:scripts` | `scripts/**` |

### Size labels (size-label workflow, by changed-line count)

| Label | Total changed lines |
| --- | --- |
| `size/xs` | ≤ 10 |
| `size/s` | ≤ 50 |
| `size/m` | ≤ 200 |
| `size/l` | ≤ 800 |
| `size/xl` | > 800 |

### Triage labels (applied by maintainers)

Commonly used to route work: `good first issue`, `help wanted`, `product`,
`bug`, `enhancement`, `question`, `documentation`, `duplicate`, `invalid`,
`wontfix`. Pick issues filtered by these on the Issues tab.

---

## Branch & PR Expectations

### Branch naming

Use a descriptive, type-prefixed branch:

```bash
git checkout -b feature/<short-description>
git checkout -b bugfix/<short-description>
git checkout -b docs/<short-description>
```

### Opening a PR

1. Push your branch to your fork.
2. Open a PR against `nextellarlabs/nextellar:main`.
3. Fill in the PR template (see `pr.md` for a full example). A good PR has:
   - An **Issues closed** list — one `Closes #NNN` line per issue the PR
     resolves. GitHub auto-closes the issue when the PR merges.
   - A **Summary** describing what changed and why.
   - A **Files changed** section listing every touched path.
   - A **Test plan** with the commands you ran and the expected result.
4. Request review from the maintainers.

### Closing issues from a PR

Always reference the issue with the `Closes` keyword so it is linked and
auto-closed on merge:

```
Closes #877
Closes #876
```

One PR may close several related issues — list each on its own `Closes #NNN`
line.

### Focus & scope

Keep PRs focused on a single concern (an issue or a tightly-related group of
issues). The path-based labeler will categorize it automatically, so you
don't need to set area/size labels yourself.

---

## Finding Issues to Work On

Filter issues on GitHub by label, e.g.:

```text
is:issue is:open label:"good first issue"
```

Read the issue description and any linked discussion before starting. When
you open a PR, reference the issue with `Closes #NNN` as described above.

---

Thank you for helping make Nextellar better! 🎉
