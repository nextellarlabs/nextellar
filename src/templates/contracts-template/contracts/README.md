# Soroban Contracts

This directory contains Soroban smart contracts for your Nextellar app.

## Prerequisites

To build and test contracts, you need:

1. [Rust](https://www.rust-lang.org/tools/install)
2. Add target: `rustup target add wasm32-unknown-unknown`
3. [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#install-the-stellar-cli)

## Commands

- **Build Contracts**: `npm run contracts:build` (from the root directory)
- **Run Tests**: `npm run contracts:test` (from the root directory)

## Deploying

Deploy using the Stellar CLI:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hello_world.wasm \
  --source alice \
  --network testnet
```

Then copy the returned contract ID to your `.env.local` file as `NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID`.
