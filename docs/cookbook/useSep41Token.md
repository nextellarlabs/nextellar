# Cookbook: SEP-41 Tokens

SEP-41 defines the standard interface for Soroban fungible tokens. The `useSep41Token` hook reads token metadata, formats balances and allowances using the contract's decimals, and builds wallet-ready unsigned XDR for token operations.

For the hook's full API, see the [`useSep41Token` reference](../hooks.md#usesep41tokenopts).

## Set up the contract

Use the deployed token contract ID and configure `useSep41Token` for the same network as the connected wallet:

```tsx
import { useSep41Token } from "@/hooks/useSep41Token";

function TokenActions({ contractId }: { contractId: string }) {
  const {
    getDecimals,
    getBalance,
    getAllowance,
    buildTransferXDR,
    buildApproveXDR,
    loading,
    error,
  } = useSep41Token({ contractId, network: "TESTNET" });

  // Token operations go here.
}
```

The contract must implement the SEP-41 interface. For a reference implementation, see the [Stellar Soroban token example](https://github.com/stellar/soroban-examples/tree/main/token).

## Handle token decimals exactly

SEP-41 `decimals()` returns a `u32`; `balance`, `allowance`, `transfer`, and `approve` use integer `i128` units. The hook reads decimals from the token and converts between display strings and raw `bigint` values without JavaScript floating-point arithmetic. It supports token precision from 0 to 38 decimal places.

The conversion helpers are also exported when an app needs to format an amount outside the hook:

```ts
import { formatSep41Amount, parseSep41Amount } from "@/hooks/useSep41Token";

const rawAmount = parseSep41Amount("12.34", 7); // 123400000n
const displayAmount = formatSep41Amount(rawAmount, 7); // "12.34"
```

## Read decimals and balance

`getDecimals` reads the token's precision. `getBalance` and `getAllowance` return both the raw smallest-unit value and its exact display form:

```tsx
const decimals = await getDecimals();
const balance = await getBalance(ownerAddress);
const allowance = await getAllowance(ownerAddress, spenderAddress);

console.log(`${balance.formatted} tokens (${balance.raw} raw units)`);
console.log(
  `${allowance.formatted} approved at ${allowance.decimals} decimals`,
);
```

Handle rejected calls in the UI and surface the hook's `error`; do not display a failed request as a zero balance. Both the token contract and the wallet must be on the selected network.

## Transfer tokens

Pass the user's decimal string to `buildTransferXDR`. The hook reads the token's decimals and converts the amount to its raw `i128` units:

```tsx
const unsignedXdr = await buildTransferXDR({
  from: ownerAddress,
  to: recipientAddress,
  amount: "12.34",
});
```

The method only builds unsigned XDR. Pass it through your wallet adapter's Soroban preparation, authorization, signing, and submission flow; it does not submit the transaction itself. The `from` account must authorize the transfer. These examples use regular account addresses, not muxed destinations.

## Approve a spender

SEP-41 `approve(from, spender, amount, live_until_ledger)` authorizes a spender up to the raw-unit amount until the specified ledger. Choose a future ledger according to your app's policy.

```tsx
const unsignedApprovalXdr = await buildApproveXDR({
  from: ownerAddress,
  spender: spenderAddress,
  amount: "12.34",
  liveUntilLedger,
});
```

`liveUntilLedger` must be a `u32` ledger number chosen by the application; for a nonzero approval, it should be a future ledger. An allowance is a spending limit, not a reservation of the owner's balance. Approving again replaces the existing allowance; when increasing an allowance, follow SEP-41's guidance to first set it to zero and confirm the current allowance was not spent. Only approve the amount and duration the app needs.

## Related

- [Soroban token contract example](https://github.com/stellar/soroban-examples/tree/main/token)
- [SEP-41: Token Interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
- [`useSorobanContract` reference](../hooks.md#usesorobancontractopts)
