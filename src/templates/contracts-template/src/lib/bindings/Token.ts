/**
 * Auto-generated Soroban contract bindings for Token
 * Generated: 2026-11-24T04:04:08.699Z
 * 
 * This file provides typed client methods for interacting with the Token contract.
 * Use the generated functions with useSorobanContract hook for proper XDR encoding/decoding.
 * 
 * @example
 * ```tsx
 * import { useSorobanContract } from '@/hooks/useSorobanContract';
 * import { TokenClient } from '@/lib/bindings/token';
 * 
 * function MyComponent() {
 *   const contract = useSorobanContract({
 *     contractId: 'CXXXX...',
 *     network: 'TESTNET',
 *   });
 * 
 *   const client = new TokenClient(contract);
 *   const result = await client.someFunction({ arg1: 'value' });
 * }
 * ```
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

/**
 * Error codes for this contract
 */
export enum TokenErrors {
  /** The contract has already been initialized */
  AlreadyInitialized = 1,
  /** The contract has not been initialized yet */
  NotInitialized = 2,
  /** Amounts must be zero or positive */
  NegativeAmount = 3,
  /** The address does not hold enough tokens */
  InsufficientBalance = 4,
  /** The allowance is too small for this transfer */
  InsufficientAllowance = 5,
}

/**
 * Arguments for Initialize function
 * Initialize token metadata and the admin allowed to mint
 */
export interface InitializeArgs {
  admin: string; // Admin address allowed to mint
  decimal: number; // Number of decimals used to represent amounts
  name: string; // Token name
  symbol: string; // Token symbol
}

/**
 * Arguments for Mint function
 * Mint new tokens to an address. Requires the admin's authorization
 */
export interface MintArgs {
  to: string; // Address receiving the minted tokens
  amount: bigint; // Amount of tokens to mint
}

/**
 * Arguments for Balance function
 * Return the token balance held by an address
 */
export interface BalanceArgs {
  id: string; // Address to query
}

/**
 * Arguments for Allowance function
 * Return the amount a spender may still transfer on behalf of an owner. Expired allowances report 0
 */
export interface AllowanceArgs {
  from: string; // Owner of the tokens
  spender: string; // Address allowed to spend
}

/**
 * Arguments for Approve function
 * Approve a spender to transfer up to an amount until an expiration ledger. Requires the owner's authorization
 */
export interface ApproveArgs {
  from: string; // Owner of the tokens
  spender: string; // Address allowed to spend
  amount: bigint; // Maximum amount the spender may transfer
  expiration_ledger: number; // Ledger at which the allowance expires
}

/**
 * Arguments for Transfer function
 * Transfer tokens from one address to another. Requires the sender's authorization
 */
export interface TransferArgs {
  from: string; // Address sending the tokens
  to: string; // Address receiving the tokens
  amount: bigint; // Amount of tokens to transfer
}

/**
 * Arguments for Transfer_from function
 * Transfer tokens using an allowance. Requires the spender's authorization
 */
export interface Transfer_fromArgs {
  spender: string; // Address spending the allowance
  from: string; // Owner of the tokens
  to: string; // Address receiving the tokens
  amount: bigint; // Amount of tokens to transfer
}

/**
 * Arguments for Burn function
 * Burn tokens from an address. Requires the owner's authorization
 */
export interface BurnArgs {
  from: string; // Address whose tokens are burned
  amount: bigint; // Amount of tokens to burn
}

/**
 * Arguments for Burn_from function
 * Burn tokens using an allowance. Requires the spender's authorization
 */
export interface Burn_fromArgs {
  spender: string; // Address spending the allowance
  from: string; // Address whose tokens are burned
  amount: bigint; // Amount of tokens to burn
}

/**
 * Return value for Admin function
 */
export type AdminResult = string;

/**
 * Return value for Decimals function
 */
export type DecimalsResult = number;

/**
 * Return value for Name function
 */
export type NameResult = string;

/**
 * Return value for Symbol function
 */
export type SymbolResult = string;

/**
 * Return value for Total_supply function
 */
export type Total_supplyResult = bigint;

/**
 * Return value for Balance function
 */
export type BalanceResult = bigint;

/**
 * Return value for Allowance function
 */
export type AllowanceResult = bigint;

/**
 * Typed client for Token contract interactions
 */
export class TokenClient {
  constructor(private contract: SorobanContractReturn) {}

  /**
   * Initialize token metadata and the admin allowed to mint
   * @param args - Function arguments
   * @returns void
   */
  async initialize(args: InitializeArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.admin, type: "address" },
      { value: args.decimal, type: "u32" },
      { value: args.name, type: "string" },
      { value: args.symbol, type: "string" },
    ];
    const result = await this.contract.callFunction('initialize', callArgs);
    return result as void;
  }

  /**
   * Return the admin address allowed to mint
   * @param args - Function arguments
   * @returns AdminResult
   */
  async admin(): Promise<AdminResult> {
    const callArgs: TypedArg[] = [
    ];
    const result = await this.contract.callFunction('admin', callArgs);
    return result as AdminResult;
  }

  /**
   * Mint new tokens to an address. Requires the admin's authorization
   * @param args - Function arguments
   * @returns void
   */
  async mint(args: MintArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.to, type: "address" },
      { value: args.amount, type: "i128" },
    ];
    const result = await this.contract.callFunction('mint', callArgs);
    return result as void;
  }

  /**
   * Return the number of decimals used to represent amounts
   * @param args - Function arguments
   * @returns DecimalsResult
   */
  async decimals(): Promise<DecimalsResult> {
    const callArgs: TypedArg[] = [
    ];
    const result = await this.contract.callFunction('decimals', callArgs);
    return result as DecimalsResult;
  }

  /**
   * Return the token name
   * @param args - Function arguments
   * @returns NameResult
   */
  async name(): Promise<NameResult> {
    const callArgs: TypedArg[] = [
    ];
    const result = await this.contract.callFunction('name', callArgs);
    return result as NameResult;
  }

  /**
   * Return the token symbol
   * @param args - Function arguments
   * @returns SymbolResult
   */
  async symbol(): Promise<SymbolResult> {
    const callArgs: TypedArg[] = [
    ];
    const result = await this.contract.callFunction('symbol', callArgs);
    return result as SymbolResult;
  }

  /**
   * Return the total number of tokens in existence
   * @param args - Function arguments
   * @returns Total_supplyResult
   */
  async total_supply(): Promise<Total_supplyResult> {
    const callArgs: TypedArg[] = [
    ];
    const result = await this.contract.callFunction('total_supply', callArgs);
    return result as Total_supplyResult;
  }

  /**
   * Return the token balance held by an address
   * @param args - Function arguments
   * @returns BalanceResult
   */
  async balance(args: BalanceArgs): Promise<BalanceResult> {
    const callArgs: TypedArg[] = [
      { value: args.id, type: "address" },
    ];
    const result = await this.contract.callFunction('balance', callArgs);
    return result as BalanceResult;
  }

  /**
   * Return the amount a spender may still transfer on behalf of an owner. Expired allowances report 0
   * @param args - Function arguments
   * @returns AllowanceResult
   */
  async allowance(args: AllowanceArgs): Promise<AllowanceResult> {
    const callArgs: TypedArg[] = [
      { value: args.from, type: "address" },
      { value: args.spender, type: "address" },
    ];
    const result = await this.contract.callFunction('allowance', callArgs);
    return result as AllowanceResult;
  }

  /**
   * Approve a spender to transfer up to an amount until an expiration ledger. Requires the owner's authorization
   * @param args - Function arguments
   * @returns void
   */
  async approve(args: ApproveArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.from, type: "address" },
      { value: args.spender, type: "address" },
      { value: args.amount, type: "i128" },
      { value: args.expiration_ledger, type: "u32" },
    ];
    const result = await this.contract.callFunction('approve', callArgs);
    return result as void;
  }

  /**
   * Transfer tokens from one address to another. Requires the sender's authorization
   * @param args - Function arguments
   * @returns void
   */
  async transfer(args: TransferArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.from, type: "address" },
      { value: args.to, type: "address" },
      { value: args.amount, type: "i128" },
    ];
    const result = await this.contract.callFunction('transfer', callArgs);
    return result as void;
  }

  /**
   * Transfer tokens using an allowance. Requires the spender's authorization
   * @param args - Function arguments
   * @returns void
   */
  async transfer_from(args: Transfer_fromArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.spender, type: "address" },
      { value: args.from, type: "address" },
      { value: args.to, type: "address" },
      { value: args.amount, type: "i128" },
    ];
    const result = await this.contract.callFunction('transfer_from', callArgs);
    return result as void;
  }

  /**
   * Burn tokens from an address. Requires the owner's authorization
   * @param args - Function arguments
   * @returns void
   */
  async burn(args: BurnArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.from, type: "address" },
      { value: args.amount, type: "i128" },
    ];
    const result = await this.contract.callFunction('burn', callArgs);
    return result as void;
  }

  /**
   * Burn tokens using an allowance. Requires the spender's authorization
   * @param args - Function arguments
   * @returns void
   */
  async burn_from(args: Burn_fromArgs): Promise<void> {
    const callArgs: TypedArg[] = [
      { value: args.spender, type: "address" },
      { value: args.from, type: "address" },
      { value: args.amount, type: "i128" },
    ];
    const result = await this.contract.callFunction('burn_from', callArgs);
    return result as void;
  }

}
