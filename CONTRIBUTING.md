# Contributing to Nextellar

Thank you for considering contributing! We welcome contributions of any size.

## Getting Started

New contributor? Start with a good first issue:
- Browse good first issues at https://github.com/nextellarlabs/nextellar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22
- These are self-contained, verified-against-the-code tasks with acceptance criteria.

### Setup

`ash
npm ci
npm test
npm run build
npm start -- my-test-app --defaults --skip-install
```n
## Area Labels

- area:cli - Commands and flags (bin/, src/lib/)
- area:templates - Scaffolding templates (src/templates/)
- area:testing - Test coverage
- area:ci - CI, packaging, repo infrastructure
- area:components - Template UI components

## Difficulty Labels

- difficulty:easy - small, clearly bounded
- difficulty:medium - standard feature, multiple files
- difficulty:hard - integration/architectural work

## Issue Workflow

1. Fork the repository and create a branch from main.
2. Pick an issue - the issue body is the best spec with Context, Task, Acceptance criteria, and Files to touch.
3. Implement the change following the acceptance criteria.
4. Run tests - npm test must pass.
5. Open a Pull Request referencing the issue with Closes #<issue-number>.
6. CI must be green.

## Branch Naming

- feat/ - new features
- fix/ - bug fixes
- docs/ - documentation changes
- test/ - test-only changes
- chore/ - build, CI, or repo maintenance

## Coding Guidelines

- Use TypeScript for all new code
- Follow the existing code style (ESLint + Prettier configured)
- Write tests for new functionality
- Keep changes focused - one issue per PR
- No unrelated refactors or formatting changes
