/**
 * Auto-generated Soroban contract bindings for HelloWorld
 * Generated: 2026-08-24T21:30:00.000Z
 * 
 * This file provides typed client methods for interacting with the HelloWorld contract.
 * Use the generated functions with useSorobanContract hook for proper XDR encoding/decoding.
 * 
 * @example
 * ```tsx
 * import { useSorobanContract } from '@/hooks/useSorobanContract';
 * import { HelloWorldClient } from '@/lib/bindings/HelloWorld';
 * 
 * function MyComponent() {
 *   const contract = useSorobanContract({
 *     contractId: 'CXXXX...',
 *     network: 'TESTNET',
 *   });
 * 
 *   const client = new HelloWorldClient(contract);
 *   const result = await client.hello({ to: 'world' });
 * }
 * ```
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

/**
 * Arguments for Hello function
 * Greets a recipient by returning a vector of symbols
 */
export interface HelloArgs {
  to: string; // The recipient symbol to greet
}

/**
 * Return value for Hello function
 */
export type HelloResult = string[];

/**
 * Typed client for HelloWorld contract interactions
 */
export class HelloWorldClient {
  constructor(private contract: SorobanContractReturn) {}

  /**
   * Greets a recipient by returning a vector of symbols
   * @param args - Function arguments
   * @returns HelloResult
   */
  async hello(args: HelloArgs): Promise<HelloResult> {
    const callArgs: TypedArg[] = [
      { value: args.to, type: "symbol" },
    ];
    const result = await this.contract.callFunction('hello', callArgs);
    return result as HelloResult;
  }

}
