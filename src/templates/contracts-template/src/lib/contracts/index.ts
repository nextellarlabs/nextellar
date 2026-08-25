import { StrKey } from "@stellar/stellar-sdk";

const PLACEHOLDER_CONTRACT_ID = "C_REPLACE_WITH_YOUR_CONTRACT_ID";

/**
 * Validates that a string is a well-formed Soroban contract ID
 * (a StrKey-encoded contract address, e.g. "C...", 56 characters).
 */
export function isValidContractId(contractId: string): boolean {
  if (
    !contractId ||
    typeof contractId !== "string" ||
    contractId.trim().length === 0
  ) {
    return false;
  }
  return StrKey.isValidContract(contractId.trim());
}

/**
 * Deployed Soroban Contract IDs.
 * Replace these placeholders with your actual deployed contract IDs (e.g., from `stellar contract deploy`).
 */
export const CONTRACTS = {
  HELLO_WORLD: process.env.NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID || PLACEHOLDER_CONTRACT_ID,
  COUNTER: process.env.NEXT_PUBLIC_COUNTER_CONTRACT_ID || PLACEHOLDER_CONTRACT_ID,
};

/**
 * Validates every entry in `CONTRACTS`, throwing a clear error that names the
 * offending env var (rather than letting a placeholder/invalid contract ID
 * silently flow into a transaction and fail deep inside the Stellar SDK).
 * Call this once at app bootstrap (e.g. in a root layout or provider) once
 * you've deployed your contracts and set their env vars.
 */
export function validateContracts(): void {
  const entries: Array<[keyof typeof CONTRACTS, string]> = [
    ["HELLO_WORLD", "NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID"],
    ["COUNTER", "NEXT_PUBLIC_COUNTER_CONTRACT_ID"],
  ];

  for (const [key, envVar] of entries) {
    const contractId = CONTRACTS[key];
    if (!isValidContractId(contractId)) {
      const reason =
        contractId === PLACEHOLDER_CONTRACT_ID
          ? `${envVar} is not set — using the unset placeholder`
          : `${envVar} is set to an invalid value`;
      throw new Error(
        `Invalid Soroban contract ID for ${key}: "${contractId}" (${reason}). Deploy your contract and set ${envVar} in .env.local to a valid StrKey-encoded contract address.`,
      );
    }
  }
}

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
