# Soroban Contracts

This directory contains Soroban smart contracts for your Nextellar app:

| Contract | Description |
| --- | --- |
| `hello_world` | Minimal contract that returns a greeting vector |
| `counter` | State-management example: increment, decrement, add, reset |
| `token` | SEP-41 fungible token with admin mint, allowances and burn |

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

## Token contract (SEP-41)

`contracts/token` is a standard fungible token that implements the
[SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
interface, plus an admin-only mint. Use it as the starting point for any
token, points, or reward asset your app needs.

### Interface

| Function | Authorization | Description |
| --- | --- | --- |
| `initialize(admin, decimal, name, symbol)` | none (once) | Sets metadata and the mint admin |
| `admin() -> Address` | none | Returns the mint admin |
| `mint(to, amount)` | admin | Mints new tokens to `to` |
| `transfer(from, to, amount)` | `from` | Transfers tokens |
| `transfer_from(spender, from, to, amount)` | `spender` | Transfers using an allowance |
| `approve(from, spender, amount, expiration_ledger)` | `from` | Sets an expiring allowance |
| `allowance(from, spender) -> i128` | none | Remaining allowance (`0` once expired) |
| `balance(id) -> i128` | none | Balance of an address |
| `burn(from, amount)` | `from` | Burns tokens, reducing total supply |
| `burn_from(spender, from, amount)` | `spender` | Burns using an allowance |
| `total_supply() -> i128` | none | Total tokens in existence |
| `decimals() -> u32`, `name() -> String`, `symbol() -> String` | none | Token metadata |

Amounts are `i128` and must be non-negative; violations return the
contract errors `NegativeAmount`, `InsufficientBalance`,
`InsufficientAllowance`, `AlreadyInitialized` and `NotInitialized`.

### Rust tests

`contracts/token/src/lib.rs` ships with unit tests covering metadata,
admin mint (including a missing-admin-auth failure), transfer and
insufficient balance, `approve`/`allowance` expiry, `transfer_from`
(including over-allowance and missing-auth failures), `burn`,
`burn_from`, and negative amounts:

```bash
cargo test -p token
```

### TypeScript bindings

`contracts/token/spec.json` mirrors the Rust interface and is the input
for the bindings generator. Regenerate the client after changing the
contract:

```bash
npm run generate:bindings contracts/token/spec.json --output src/lib/bindings/Token.ts --name Token
```

The generated `TokenClient` (exported from `src/lib/contracts`) is used
with `useSorobanContract`:

```tsx
import { useSorobanContract } from '@/hooks/useSorobanContract';
import { CONTRACTS, TokenClient } from '@/lib/contracts';

const contract = useSorobanContract({
  contractId: CONTRACTS.TOKEN,
  network: 'TESTNET',
});
const client = new TokenClient(contract);

const balance = await client.balance({ id: address });
await client.transfer({ from: address, to: recipient, amount: 1_000_000n });
```

Set the deployed token ID in `.env.local`:

```bash
NEXT_PUBLIC_TOKEN_CONTRACT_ID=C...
```
