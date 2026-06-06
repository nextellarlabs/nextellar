// Stellar memo validation helper for routes-d (#281).
//
// Stellar transactions support five memo types: `none`, `text` (up to
// 28 UTF-8 bytes), `id` (uint64), `hash` (32 raw bytes — accepted here
// as a 64-char hex string), and `return` (same shape as `hash`). Every
// route that builds an outgoing transaction envelope should run user
// input through `validateMemo` first so we surface field-level errors
// *before* we hit the SDK (which throws less descriptive errors).
//
// The helper is intentionally framework-agnostic: it takes a plain
// `{ type, value }` shape and returns a discriminated result. Route
// handlers translate `{ ok: false, errors }` into a 400 response.

export type MemoType = "none" | "text" | "id" | "hash" | "return";

export const MEMO_TYPES: readonly MemoType[] = Object.freeze([
  "none",
  "text",
  "id",
  "hash",
  "return",
]);

/** Stellar's max TEXT memo size — 28 UTF-8 bytes, not characters. */
export const MEMO_TEXT_MAX_BYTES = 28;

/** Stellar HASH / RETURN memos are 32 raw bytes → 64 hex characters. */
export const MEMO_HASH_HEX_LENGTH = 64;

/** uint64 ceiling for ID memos. */
const UINT64_MAX = 18446744073709551615n;

export interface MemoInput {
  type: unknown;
  /** Optional for `type: "none"`; required otherwise. */
  value?: unknown;
}

export interface FieldError {
  field: "type" | "value";
  message: string;
}

export type MemoValidationResult =
  | { ok: true; memo: { type: MemoType; value?: string } }
  | { ok: false; errors: FieldError[] };

function isMemoType(value: unknown): value is MemoType {
  return typeof value === "string" && (MEMO_TYPES as readonly string[]).includes(value);
}

function utf8ByteLength(s: string): number {
  // `Buffer.byteLength` would also work, but `TextEncoder` keeps the
  // helper portable to non-Node environments (edge runtimes, tests).
  return new TextEncoder().encode(s).length;
}

function isHex(s: string): boolean {
  return /^[0-9a-fA-F]+$/.test(s);
}

/**
 * Validate `{ type, value }` per Stellar memo rules. Returns a
 * normalised memo on success (value omitted for `type: "none"`,
 * lowercase hex for `hash` / `return`, decimal string for `id`).
 *
 * Multiple field-level errors are collected so the caller can echo
 * them all back instead of bouncing the client through a fix-one-
 * at-a-time loop.
 */
export function validateMemo(input: MemoInput): MemoValidationResult {
  const errors: FieldError[] = [];

  if (!isMemoType(input.type)) {
    errors.push({
      field: "type",
      message: `type must be one of: ${MEMO_TYPES.join(", ")}`,
    });
    return { ok: false, errors };
  }

  const type = input.type;

  if (type === "none") {
    if (input.value !== undefined && input.value !== null && input.value !== "") {
      errors.push({ field: "value", message: "value must be empty when type is 'none'" });
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, memo: { type } };
  }

  // All non-none types require a value.
  if (input.value === undefined || input.value === null || input.value === "") {
    errors.push({ field: "value", message: `value is required when type is '${type}'` });
    return { ok: false, errors };
  }

  if (type === "text") {
    if (typeof input.value !== "string") {
      errors.push({ field: "value", message: "text memo value must be a string" });
      return { ok: false, errors };
    }
    const bytes = utf8ByteLength(input.value);
    if (bytes > MEMO_TEXT_MAX_BYTES) {
      errors.push({
        field: "value",
        message: `text memo exceeds ${MEMO_TEXT_MAX_BYTES} UTF-8 bytes (got ${bytes})`,
      });
      return { ok: false, errors };
    }
    return { ok: true, memo: { type, value: input.value } };
  }

  if (type === "id") {
    // Accept string or number; reject anything else. We require a
    // non-negative integer that fits in uint64.
    const raw = typeof input.value === "number" ? input.value.toString() : input.value;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      errors.push({ field: "value", message: "id memo must be a non-negative integer" });
      return { ok: false, errors };
    }
    const asBig = BigInt(raw);
    if (asBig > UINT64_MAX) {
      errors.push({ field: "value", message: "id memo exceeds uint64 max" });
      return { ok: false, errors };
    }
    return { ok: true, memo: { type, value: asBig.toString() } };
  }

  // hash / return — 32 raw bytes encoded as 64 hex chars.
  if (typeof input.value !== "string") {
    errors.push({ field: "value", message: `${type} memo must be a hex string` });
    return { ok: false, errors };
  }
  if (input.value.length !== MEMO_HASH_HEX_LENGTH || !isHex(input.value)) {
    errors.push({
      field: "value",
      message: `${type} memo must be ${MEMO_HASH_HEX_LENGTH} hex characters (32 bytes)`,
    });
    return { ok: false, errors };
  }
  return { ok: true, memo: { type, value: input.value.toLowerCase() } };
}

/**
 * Sugar for routes that want to assert-or-throw rather than branch on
 * a result discriminator. Throws `MemoValidationError` so callers can
 * `catch` and translate to a 400.
 */
export class MemoValidationError extends Error {
  readonly errors: FieldError[];
  constructor(errors: FieldError[]) {
    super(errors.map((e) => `${e.field}: ${e.message}`).join("; "));
    this.name = "MemoValidationError";
    this.errors = errors;
  }
}

export function assertValidMemo(input: MemoInput): { type: MemoType; value?: string } {
  const result = validateMemo(input);
  if (!result.ok) {
    throw new MemoValidationError(result.errors);
  }
  return result.memo;
}
