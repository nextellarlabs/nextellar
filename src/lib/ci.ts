import type { PackageManager } from "./install.js";

/**
 * Generates the contents of a GitHub Actions CI workflow (.github/workflows/ci.yml)
 * tailored to the given package manager.
 */
export function generateCiWorkflow(
  packageManager: PackageManager = "npm",
): string {
  if (packageManager === "bun") {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Type check
        run: bun run type-check

      - name: Test
        run: bun test

      - name: Build
        run: bun run build
`;
  }

  if (packageManager === "pnpm") {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Type check
        run: pnpm type-check

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
`;
  }

  if (packageManager === "yarn") {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: yarn

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Lint
        run: yarn lint

      - name: Type check
        run: yarn type-check

      - name: Test
        run: yarn test

      - name: Build
        run: yarn build
`;
  }

  // Default: npm
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run type-check

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
`;
}
