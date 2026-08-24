/**
 * Deployed Soroban Contract IDs.
 * Replace these placeholders with your actual deployed contract IDs (e.g., from `stellar contract deploy`).
 */
export const CONTRACTS = {
  HELLO_WORLD: process.env.NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID || "C_REPLACE_WITH_YOUR_CONTRACT_ID",
  COUNTER: process.env.NEXT_PUBLIC_COUNTER_CONTRACT_ID || "C_REPLACE_WITH_YOUR_CONTRACT_ID",
};

/**
 * Contract bindings generated from spec files
 * Use these typed clients with useSorobanContract hook for type-safe contract interactions
 * 
 * @example
 * ```tsx
 * import { useSorobanContract } from '@/hooks/useSorobanContract';
 * import { HelloWorldClient, CounterClient } from '@/lib/contracts';
 * import { CONTRACTS } from '@/lib/contracts';
 * 
 * function MyComponent() {
 *   const contract = useSorobanContract({
 *     contractId: CONTRACTS.COUNTER,
 *     network: 'TESTNET',
 *   });
 * 
 *   const client = new CounterClient(contract);
 *   const count = await client.getCount();
 * }
 * ```
 */
export { HelloWorldClient } from '../bindings/HelloWorld';
export { CounterClient } from '../bindings/Counter';
