/**
 * Transaction memo helpers: per-type validation and conversion to an SDK
 * `Memo` (issue #951).
 *
 * | type     | value                                       |
 * | -------- | ------------------------------------------- |
 * | `none`   | must be empty                               |
 * | `text`   | up to 28 bytes of UTF-8 (not characters)    |
 * | `id`     | unsigned 64-bit integer, decimal digits     |
 * | `hash`   | 32 bytes as 64 hex chars                    |
 * | `return` | 32 bytes as 64 hex chars (refund tx hash)   |
 */

import { Memo } from "@stellar/stellar-sdk";

export type MemoType = "none" | "text" | "id" | "hash" | "return";

export const MEMO_TYPES: readonly MemoType[] = ["none", "text", "id", "hash", "return"];

export interface PaymentMemo {
  type: MemoType;
  value: string;
}

export const MEMO_TEXT_MAX_BYTES = 28;
const UINT64_MAX = BigInt("18446744073709551615");

/**
 * @returns an error message, or null when `value` is valid for `type`.
 */
export function validateMemo(type: MemoType, value: string): string | null {
  switch (type) {
    case "none":
      return value ? "Memo type is None but a memo value was entered." : null;
    case "text": {
      const bytes = new TextEncoder().encode(value).length;
      return bytes > MEMO_TEXT_MAX_BYTES
        ? `Text memo is ${bytes} bytes; the maximum is ${MEMO_TEXT_MAX_BYTES}.`
        : null;
    }
    case "id": {
      if (!/^\d+$/.test(value)) return "ID memo must be a whole number (digits only).";
      if (value.length > 1 && value.startsWith("0")) return "ID memo must not have leading zeros.";
      return BigInt(value) > UINT64_MAX ? "ID memo must fit in an unsigned 64-bit integer." : null;
    }
    case "hash":
    case "return":
      return /^[0-9a-fA-F]{64}$/.test(value)
        ? null
        : `${type === "hash" ? "Hash" : "Return"} memo must be 64 hexadecimal characters (32 bytes).`;
    default:
      return "Unknown memo type.";
  }
}

/**
 * Build an SDK Memo, or undefined for no memo.
 * A plain string is treated as a text memo (backwards compatible).
 *
 * @throws Error with the validation message when the memo is invalid.
 */
export function toStellarMemo(memo: string | PaymentMemo | undefined): Memo | undefined {
  if (memo === undefined || memo === "") return undefined;
  const { type, value } = typeof memo === "string" ? { type: "text" as const, value: memo } : memo;
  if (type === "text" && value === "") return undefined;
  const error = validateMemo(type, value);
  if (error) throw new Error(error);
  switch (type) {
    case "none":
      return undefined;
    case "text":
      return Memo.text(value);
    case "id":
      return Memo.id(value);
    case "hash":
      return Memo.hash(value.toLowerCase());
    case "return":
      return Memo.return(value.toLowerCase());
    default:
      throw new Error("Unknown memo type.");
  }
}
