# Soroban Contracts Overlay Guide

The `--with-contracts` flag scaffolds a set of Soroban smart contracts and their
typed front-end bindings alongside your Nextellar front end. This guide covers
the overlay's layout, how to build the contracts, and how to wire them into your
app.

## What the overlay is

When you run the CLI with `-c` / `--with-contracts`, Nextellar copies the
**contracts overlay** (`contracts-template`) on top of the base template you
selected. The overlay adds a Rust contract workspace, pre-generated TypeScript
bindings, and a small config module — without touching the base template's UI.

```bash
npx nextellar my-app --with-contracts
# or, paired with a specific template:
npx nextellar my-defi-app --template defi --with-contracts
```

After copying, the CLI also:

- Adds `contracts:build` (`cd contracts && stellar contract build`) and
  `contracts:test` (`cd contracts && cargo test`) scripts to `package.json`.
- Appends contract-ID placeholders to `.env.example`:
  ```env
  # Soroban Smart Contracts
  NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C_REPLACE_WITH_YOUR_CONTRACT_ID
  ```

A `--dry-run` scaffold lists the overlay files that would be added (marked
`(contracts overlay)`) without writing anything.

## Overlay layout

```
my-app/
├── contracts/                      # Rust workspace (the Soroban contracts)
│   ├── Cargo.toml                  # workspace manifest
│   ├── README.md
│   ├── counter/
│   │   ├── Cargo.toml
│   │   ├── spec.json               # contract interface (drives bindings)
│   │   └── src/lib.rs
│   └── hello_world/
│       ├── Cargo.toml
│       ├── spec.json
│       └── src/lib.rs
└── src/
    └── lib/
        ├── bindings/               # generated TS clients
        │   ├── Counter.ts
        │   └── HelloWorld.ts
        └── contracts/
            └── index.ts           # CONTRACTS map + validateContracts()
```

- **`contracts/<name>/`** — a standard Soroban Rust contract crate. Each has a
  `spec.json` describing its interface.
- **`src/lib/bindings/`** — typed TypeScript clients (`CounterClient`,
  `HelloWorldClient`) generated from the specs. Use them with the
  `useSorobanContract` hook for type-safe calls.
- **`src/lib/contracts/index.ts`** — exposes a `CONTRACTS` map of contract IDs
  (read from env, falling back to a placeholder) and a `validateContracts()`
  helper that throws early if a placeholder/invalid ID is still configured.

## Prerequisites

- **Rust** with the wasm target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI** for building/deploying WASM:
  ```bash
  cargo install --locked soroban-cli
  ```

## Building contracts

From the project root, use the generated scripts (they `cd` into `contracts` for
you):

```bash
# Build every contract to wasm32
npm run contracts:build

# Run Rust unit tests
npm run contracts:test
```

Equivalent raw commands, run from `contracts/`:

```bash
cd contracts
cargo build --release --target wasm32-unknown-unknown   # all contracts
cargo build -p counter --release --target wasm32-unknown-unknown  # single
cargo test
```

The compiled WASM lands in `contracts/target/wasm32-unknown-unknown/release/`.

## Deploying and wiring them in

1. **Deploy the WASM** with the Stellar CLI (testnet shown):

   ```bash
   soroban contract install \
     --network testnet \
     --source-account <YOUR_ACCOUNT> \
     --wasm contracts/target/wasm32-unknown-unknown/release/counter.wasm

   soroban contract deploy \
     --network testnet \
     --source-account <YOUR_ACCOUNT> \
     --wasm contracts/target/wasm32-unknown-unknown/release/counter.wasm \
     --salt <RANDOM_SALT>
   ```

   Copy each returned contract ID (it starts with `C…`).

2. **Set the contract IDs in `.env.local`:**

   ```env
   NEXT_PUBLIC_COUNTER_CONTRACT_ID=C<your-counter-id>
   NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C<your-hello-world-id>
   ```

   `CONTRACTS` in `src/lib/contracts/index.ts` reads these variables and falls
   back to `C_REPLACE_WITH_YOUR_CONTRACT_ID` if unset.

3. **Validate at bootstrap.** Call `validateContracts()` once when your app
   starts (e.g. in a root layout/provider). It throws a clear error naming the
   offending env var if any ID is still a placeholder or malformed, instead of
   failing deep inside the SDK later.

   ```ts
   import { validateContracts } from '@/lib/contracts';
   validateContracts();
   ```

4. **Call contracts with the generated bindings:**

   ```tsx
   import { useSorobanContract } from '@/hooks/useSorobanContract';
   import { CounterClient, CONTRACTS } from '@/lib/contracts';

   function CounterPanel() {
     const contract = useSorobanContract({
       contractId: CONTRACTS.COUNTER,
       network: 'TESTNET',
     });
     const client = new CounterClient(contract);

     const count = await client.getCount();
     await client.increment();
   }
   ```

   - `useSorobanContract` takes the contract ID and a `NETWORK` key
     (`TESTNET`/`PUBLIC`) and returns a handle the typed client consumes.
   - The generated `CounterClient` / `HelloWorldClient` expose the contract's
     functions with full argument/return typing derived from `spec.json`.

## Updating contracts

1. Edit the Rust in `contracts/<name>/src/lib.rs`.
2. If the interface changed, update `contracts/<name>/spec.json`.
3. Regenerate bindings if your workflow uses the generator, rebuild
   (`npm run contracts:build`), and redeploy with a **new salt** to get a new
   contract ID.
4. Update the corresponding `NEXT_PUBLIC_*_CONTRACT_ID` env var; `validateContracts()`
   will confirm the new IDs are valid on next boot.

## Troubleshooting

- **`target/wasm32-unknown-unknown not found`** — run
  `rustup target add wasm32-unknown-unknown`.
- **`validateContracts()` throws "not set"** — you deployed but forgot to set the
  matching `NEXT_PUBLIC_*_CONTRACT_ID` in `.env.local`.
- **Contract call fails on mainnet** — ensure `NEXT_PUBLIC_NETWORK=PUBLIC` and
  the contract was actually deployed to mainnet (testnet IDs won't exist there).
- **Bindings missing a function** — regenerate from an updated `spec.json`.

## See also

- [Soroban Contract Binding Generator](../src/templates/contracts-template/SOROBAN_SETUP.md)
- [Network and Environment Configuration Guide](./network-environment-guide.md)
- [Deployment Guide](./deploy-guide.md)
