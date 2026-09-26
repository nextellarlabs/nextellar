# Cookbook: `useSorobanContract`

The `useSorobanContract` hook provides a type-safe interface for interacting with Soroban smart contracts on the Stellar network. It simplifies contract initialization, read/write invocations, status handling, and simulation.

---

## Overview

Use `useSorobanContract` when your dApp needs to:
- Read contract storage or invoke view functions (`invokeRead`).
- Submit state-changing contract transactions (`invokeWrite`).
- Simulate transactions before execution.
- Handle RPC errors and transaction lifecycle events.

---

## Basic Usage

```tsx
import { useSorobanContract } from 'nextellar/hooks';

const CONTRACT_ID = 'CCW67TSB5E63O...';

function CounterComponent() {
  const { invokeRead, invokeWrite, loading, error } = useSorobanContract(CONTRACT_ID);
  const [count, setCount] = useState<number | null>(null);

  const fetchCount = async () => {
    const value = await invokeRead('get_count');
    setCount(value);
  };

  const increment = async () => {
    await invokeWrite('increment');
    await fetchCount();
  };

  return (
    <div>
      <p>Current Count: {count ?? 'Loading...'}</p>
      <button onClick={increment} disabled={loading}>
        {loading ? 'Incrementing...' : 'Increment'}
      </button>
      {error && <p className="text-red-500">Error: {error.message}</p>}
    </div>
  );
}
```

---

## Passing Arguments & Types

Pass custom arguments to contract functions using Soroban Native/ScVal types:

```tsx
const transferTokens = async (recipient: string, amount: bigint) => {
  const result = await invokeWrite('transfer', [
    { type: 'Address', value: recipient },
    { type: 'i128', value: amount.toString() },
  ]);
  console.log('Transaction hash:', result.hash);
};
```

---

## Best Practices & Tips

1. **Simulate Before Submitting**: Use `invokeRead` to test view calls and gas estimations.
2. **Error Handling**: Always catch `ContractExecutionError` to display human-readable status codes to users.
3. **Network Synchronization**: Ensure your `SorobanRpc` endpoint matches the wallet's current network (Testnet/Mainnet).
