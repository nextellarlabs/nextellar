/**
 * Soroban contract bindings for the Escrow example contract
 * (see contracts/escrow/src/lib.rs).
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

export interface EscrowInitializeArgs {
  depositor: string;
  beneficiary: string;
  arbiter: string;
  /** Token (SAC) contract address, e.g. "C..." */
  token: string;
  /** Amount in the token's smallest unit (stroops for 7-decimal assets). */
  amount: bigint | number | string;
  /** Unix timestamp (seconds) after which the depositor can reclaim funds. */
  deadline: number;
}

export type EscrowStatus = 'Created' | 'Funded' | 'Released' | 'Refunded';

export class EscrowClient {
  constructor(private contract: SorobanContractReturn) {}

  async initialize(args: EscrowInitializeArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.depositor, type: 'address' },
      { value: args.beneficiary, type: 'address' },
      { value: args.arbiter, type: 'address' },
      { value: args.token, type: 'address' },
      { value: args.amount, type: 'i128' },
      { value: args.deadline, type: 'u64' },
    ];
    await this.contract.callFunction('initialize', callArgs);
  }

  /** Depositor funds the escrow. */
  async deposit(): Promise<void> {
    await this.contract.callFunction('deposit', []);
  }

  /** Depositor or arbiter pays the beneficiary. `approver` must sign. */
  async release(approver: string): Promise<void> {
    await this.contract.callFunction('release', [{ value: approver, type: 'address' }]);
  }

  /** Beneficiary or arbiter returns funds to the depositor. `caller` must sign. */
  async refund(caller: string): Promise<void> {
    await this.contract.callFunction('refund', [{ value: caller, type: 'address' }]);
  }

  /** Depositor reclaims funds after the deadline has passed. */
  async timeout(): Promise<void> {
    await this.contract.callFunction('timeout', []);
  }

  async status(): Promise<EscrowStatus> {
    const result = await this.contract.callFunction('status', []);
    // Unit-variant enums decode as { tag } or a bare string depending on the SDK path.
    const tag = typeof result === 'object' && result !== null ? (result as { tag: string }).tag : result;
    return tag as EscrowStatus;
  }

  async config(): Promise<unknown> {
    return this.contract.callFunction('config', []);
  }
}
