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