"use client";

import { useCallback, useState } from "react";
import {
  useSorobanContract,
  type ContractCallSpec,
  type SorobanContractOptions,
  type SorobanContractReturn,
} from "./useSorobanContract";

const MAX_TOKEN_DECIMALS = 38;
const MAX_I128 = (1n << 127n) - 1n;
const MAX_U32 = 0xffff_ffff;

export interface Sep41TokenAmount {
  /** Amount in the token's smallest units. */
  raw: bigint;
  /** Exact decimal representation using the token's decimals. */
  formatted: string;
  decimals: number;
}

export interface Sep41TransferParams {
  from: string;
  to: string;
  /** Human-readable amount, for example "1.25". */
  amount: string;
}

export interface Sep41ApproveParams {
  from: string;
  spender: string;
  /** Human-readable amount, for example "1.25". */
  amount: string;
  liveUntilLedger: number;
}

export interface Sep41TransferFromParams {
  spender: string;
  from: string;
  to: string;
  /** Human-readable amount, for example "1.25". */
  amount: string;
}

export interface Sep41TokenReturn {
  getDecimals: () => Promise<number>;
  getBalance: (account: string) => Promise<Sep41TokenAmount>;
  getAllowance: (from: string, spender: string) => Promise<Sep41TokenAmount>;
  /** Build unsigned XDR; the `from` account must authorize and sign it. */
  buildTransferXDR: (params: Sep41TransferParams) => Promise<string>;
  /** Build unsigned XDR; the `from` account must authorize and sign it. */
  buildApproveXDR: (params: Sep41ApproveParams) => Promise<string>;
  /** Build unsigned XDR; the `spender` account must authorize and sign it. */
  buildTransferFromXDR: (params: Sep41TransferFromParams) => Promise<string>;
  loading: boolean;
  error: Error | null;
}

function assertDecimals(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TOKEN_DECIMALS
  ) {
    throw new Error(
      `Unsupported token decimals: expected an integer from 0 to ${MAX_TOKEN_DECIMALS}.`,
    );
  }
  return value;
}

/** Convert a human-readable token amount to its integer smallest-unit value. */
export function parseSep41Amount(amount: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    throw new Error("Token amount must be a non-negative decimal number.");
  }

  const [whole, fraction = ""] = amount.split(".");
  const supportedFraction = fraction.slice(0, decimals);
  const excessFraction = fraction.slice(decimals);
  if (/[1-9]/.test(excessFraction)) {
    throw new Error(
      `Token amount has more than ${decimals} significant decimal places.`,
    );
  }

  const scale = 10n ** BigInt(decimals);
  const fractionalUnits = supportedFraction.padEnd(decimals, "0");
  const raw = BigInt(whole) * scale + BigInt(fractionalUnits || "0");
  if (raw > MAX_I128) {
    throw new Error("Token amount exceeds the maximum supported i128 value.");
  }
  return raw;
}

/** Format an i128 token amount without converting it through `number`. */
export function formatSep41Amount(raw: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (raw < 0n || raw > MAX_I128) {
    throw new Error(
      "Token amount is outside the supported non-negative i128 range.",
    );
  }

  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * SEP-41 convenience methods built on the template's Soroban contract hook.
 * Read methods return exact decimal amounts; write methods return unsigned XDR
 * for a wallet adapter to prepare, authorize, sign, and submit.
 */
export function useSep41Token(
  options: SorobanContractOptions,
): Sep41TokenReturn {
  const contract: SorobanContractReturn = useSorobanContract(options);
  const [activeOperations, setActiveOperations] = useState(0);
  const [operationError, setOperationError] = useState<Error | null>(null);

  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      setActiveOperations((count) => count + 1);
      setOperationError(null);
      try {
        return await operation();
      } catch (reason) {
        const error = toError(reason);
        setOperationError(error);
        throw error;
      } finally {
        setActiveOperations((count) => Math.max(0, count - 1));
      }
    },
    [],
  );

  const readDecimals = useCallback(async (): Promise<number> => {
    const result = await contract.callFunction("decimals", []);
    return assertDecimals(result);
  }, [contract.callFunction]);

  const readI128 = useCallback(
    async (name: "balance" | "allowance", args: string[]): Promise<bigint> => {
      const result = await contract.callFunction(
        name,
        args.map((value) => ({ value, type: "address" as const })),
      );
      if (typeof result !== "bigint") {
        throw new Error(`Token ${name}() returned a non-i128 amount.`);
      }
      if (result < 0n) {
        throw new Error(`Token ${name}() returned a negative amount.`);
      }
      return result;
    },
    [contract.callFunction],
  );

  const getDecimals = useCallback(() => run(readDecimals), [readDecimals, run]);

  const getBalance = useCallback(
    (account: string) =>
      run(async () => {
        const decimals = await readDecimals();
        const raw = await readI128("balance", [account]);
        return { raw, formatted: formatSep41Amount(raw, decimals), decimals };
      }),
    [readDecimals, readI128, run],
  );

  const getAllowance = useCallback(
    (from: string, spender: string) =>
      run(async () => {
        const decimals = await readDecimals();
        const raw = await readI128("allowance", [from, spender]);
        return { raw, formatted: formatSep41Amount(raw, decimals), decimals };
      }),
    [readDecimals, readI128, run],
  );

  const buildXDR = useCallback(
    async (call: ContractCallSpec, sourceAccount: string): Promise<string> => {
      const [xdr] = await contract.buildBatchInvokeXDRs([call], sourceAccount);
      if (!xdr) {
        throw new Error(`Failed to build the ${call.name} token transaction.`);
      }
      return xdr;
    },
    [contract.buildBatchInvokeXDRs],
  );

  const buildTransferXDR = useCallback(
    (params: Sep41TransferParams) =>
      run(async () => {
        const decimals = await readDecimals();
        const amount = parseSep41Amount(params.amount, decimals);
        return buildXDR(
          {
            name: "transfer",
            args: [
              { value: params.from, type: "address" },
              { value: params.to, type: "address" },
              { value: amount, type: "i128" },
            ],
          },
          params.from,
        );
      }),
    [buildXDR, readDecimals, run],
  );

  const buildApproveXDR = useCallback(
    (params: Sep41ApproveParams) =>
      run(async () => {
        if (
          !Number.isInteger(params.liveUntilLedger) ||
          params.liveUntilLedger < 0 ||
          params.liveUntilLedger > MAX_U32
        ) {
          throw new Error(
            "liveUntilLedger must be an integer between 0 and 4294967295.",
          );
        }
        const decimals = await readDecimals();
        const amount = parseSep41Amount(params.amount, decimals);
        return buildXDR(
          {
            name: "approve",
            args: [
              { value: params.from, type: "address" },
              { value: params.spender, type: "address" },
              { value: amount, type: "i128" },
              { value: params.liveUntilLedger, type: "u32" },
            ],
          },
          params.from,
        );
      }),
    [buildXDR, readDecimals, run],
  );

  const buildTransferFromXDR = useCallback(
    (params: Sep41TransferFromParams) =>
      run(async () => {
        const decimals = await readDecimals();
        const amount = parseSep41Amount(params.amount, decimals);
        return buildXDR(
          {
            name: "transfer_from",
            args: [
              { value: params.spender, type: "address" },
              { value: params.from, type: "address" },
              { value: params.to, type: "address" },
              { value: amount, type: "i128" },
            ],
          },
          params.spender,
        );
      }),
    [buildXDR, readDecimals, run],
  );

  return {
    getDecimals,
    getBalance,
    getAllowance,
    buildTransferXDR,
    buildApproveXDR,
    buildTransferFromXDR,
    loading: contract.loading || activeOperations > 0,
    error: operationError ?? contract.error ?? null,
  };
}
