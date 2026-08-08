# Contributing to Nextellar

Thank you for considering contributing! We welcome contributions of any size.

## Getting Started

New contributor? Start with a good first issue:
- Browse good first issues at https://github.com/nextellarlabs/nextellar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22
- These are self-contained, verified-against-the-code tasks with acceptance criteria.

### Setup

```bash
npm ci
npm test
npm run build
### Setup
```bash
npm ci
npm test
npm run build
npm start -- my-test-app --defaults --skip-install
```

Ensure all checks pass before submitting.

### E2E Tests (Optional but Recommended)
For changes to scaffolding or templates, run the E2E tests to ensure production builds work:

```bash
npm run test:e2e
```

E2E tests are **skipped by default** in `npm test` because they take 2-5 minutes. They validate that scaffolded apps install and build successfully.

See `tests/e2e/README.md` for more details.
