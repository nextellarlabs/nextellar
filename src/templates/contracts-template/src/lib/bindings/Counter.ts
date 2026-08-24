/**
 * Auto-generated Soroban contract bindings for Counter
 * Generated: 2026-08-24T21:45:00.000Z
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

export interface InitializeArgs {
  initial_count: number;
}

export interface AddArgs {
  amount: number;
}

export type GetCountResult = number;
export type IncrementResult = number;
export type DecrementResult = number;
export type AddResult = number;

export class CounterClient {
  constructor(private contract: SorobanContractReturn) {}

  async initialize(args: InitializeArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.initial_count, type: "i32" },
    ];
    await this.contract.callFunction('initialize', callArgs);
  }

  async getCount(): Promise<GetCountResult> {
    const callArgs: TypedArg[] = [];
    const result = await this.contract.callFunction('get_count', callArgs);
    return result as GetCountResult;
  }

  async increment(): Promise<IncrementResult> {
    const callArgs: TypedArg[] = [];
    const result = await this.contract.callFunction('increment', callArgs);
    return result as IncrementResult;
  }

  async decrement(): Promise<DecrementResult> {
    const callArgs: TypedArg[] = [];
    const result = await this.contract.callFunction('decrement', callArgs);
    return result as DecrementResult;
  }

  async add(args: AddArgs): Promise<AddResult> {
    const callArgs: TypedArg[] = [
      { value: args.amount, type: "i32" },
    ];
    const result = await this.contract.callFunction('add', callArgs);
    return result as AddResult;
  }

  async reset(): Promise<void> {
    const callArgs: TypedArg[] = [];
    await this.contract.callFunction('reset', callArgs);
  }
}
