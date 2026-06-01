# routes-d contributor setup

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer

## Install

From the repository root:

```bash
cd routes-d
npm install
```

## Build

```bash
npm run build
```

TypeScript output is written to `routes-d/dist/`.

## Run tests

Run the full routes-d Jest suite:

```bash
npm test
```

Run only unit tests:

```bash
npm run test:unit
```

Run only integration tests:

```bash
npm run test:integration
```

Run a single file:

```bash
npx jest --config jest.config.js tests/orders.list.test.ts
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ROUTES_D_CURSOR_SECRET` | Signs cursor tokens for paginated list routes (16+ characters in production) |
| `HORIZON_URL` / `HORIZON_PRIMARY_URL` | Primary Horizon endpoint |
| `HORIZON_FALLBACK_URL` | Optional fallback Horizon endpoint |
| `HORIZON_TIMEOUT_MS` | Per-request Horizon timeout |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint for invoke and health routes |

## Troubleshooting

### `Invalid cursor signature` during list tests

Set `ROUTES_D_CURSOR_SECRET` to the same value used when the cursor was created. Local tests inject a fixed secret in the router options.

### Jest ESM import errors

Ensure `NODE_OPTIONS=--experimental-vm-modules` is set. The `npm test` script in `routes-d/package.json` sets this automatically.

### TypeScript cannot find `.js` imports

routes-d uses NodeNext module resolution. Keep import specifiers aligned with emitted `.js` filenames (for example `../lib/pagination.js`).

### Horizon or Soroban tests time out

Chaos and client tests stub `fetch` or inject RPC mocks. If a test reaches the network, confirm the test uses the provided fake fetcher rather than the default global `fetch`.

### `npm test` passes locally but fails in CI

Run `npm run build` before tests in CI if a job compiles routes-d separately. Confirm the job executes from `routes-d/` with devDependencies installed.
