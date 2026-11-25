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

## Example: Escrow (`escrow/`)

Demonstrates multi-party authorization and a time-locked release. Three
parties: a **depositor** (funds it), a **beneficiary** (gets paid) and an
**arbiter** (neutral third party).

| Function | Who must sign | Effect |
| --- | --- | --- |
| `initialize(depositor, beneficiary, arbiter, token, amount, deadline)` | – | One-time setup; `deadline` is a unix timestamp in the future |
| `deposit()` | depositor | Moves `amount` of `token` into the contract (before the deadline) |
| `release(approver)` | depositor **or** arbiter | Pays the beneficiary (before the deadline) |
| `refund(caller)` | beneficiary **or** arbiter | Returns funds to the depositor |
| `timeout()` | depositor | After the deadline, depositor reclaims funds alone |
| `status()` / `config()` | – | Read state (`Created`, `Funded`, `Released`, `Refunded`) |

Errors: `AlreadyInitialized`, `NotInitialized`, `InvalidAmount`,
`InvalidDeadline`, `InvalidState`, `Unauthorized`, `DeadlineNotReached`,
`DeadlinePassed`. Funds can leave the contract exactly once.

Run its tests with `cd contracts && cargo test -p escrow`.

Set `NEXT_PUBLIC_ESCROW_CONTRACT_ID` after deploying, then use the typed client:

```tsx
import { useSorobanContract } from '@/hooks/useSorobanContract';
import { CONTRACTS, EscrowClient } from '@/lib/contracts';

function EscrowPanel({ me }: { me: string }) {
  const contract = useSorobanContract({
    contractId: CONTRACTS.ESCROW,
    network: 'TESTNET',
  });
  const escrow = new EscrowClient(contract);

  return (
    <>
      <button onClick={() => escrow.deposit()}>Deposit (depositor)</button>
      <button onClick={() => escrow.release(me)}>Release (depositor/arbiter)</button>
      <button onClick={() => escrow.refund(me)}>Refund (beneficiary/arbiter)</button>
      <button onClick={() => escrow.timeout()}>Reclaim after deadline</button>
    </>
  );
}
```
