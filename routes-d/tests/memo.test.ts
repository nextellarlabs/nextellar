// Tests for the Stellar memo validation helper (#281).

import {
  MEMO_HASH_HEX_LENGTH,
  MEMO_TEXT_MAX_BYTES,
  MemoValidationError,
  assertValidMemo,
  validateMemo,
} from "../lib/memo.js";

describe("validateMemo", () => {
  describe("type discrimination", () => {
    it("rejects unknown types with a field-level error", () => {
      const result = validateMemo({ type: "garbage", value: "x" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "type", message: expect.stringMatching(/type must be one of/) },
        ]);
      }
    });

    it("rejects non-string type", () => {
      const result = validateMemo({ type: 42 as unknown, value: "x" });
      expect(result.ok).toBe(false);
    });
  });

  describe("type: none", () => {
    it("accepts an absent value", () => {
      expect(validateMemo({ type: "none" })).toEqual({ ok: true, memo: { type: "none" } });
    });

    it("accepts an empty-string value", () => {
      expect(validateMemo({ type: "none", value: "" })).toEqual({
        ok: true,
        memo: { type: "none" },
      });
    });

    it("rejects a non-empty value for type: none", () => {
      const result = validateMemo({ type: "none", value: "hi" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].field).toBe("value");
      }
    });
  });

  describe("type: text", () => {
    it("accepts a short ASCII string", () => {
      const result = validateMemo({ type: "text", value: "hello" });
      expect(result).toEqual({ ok: true, memo: { type: "text", value: "hello" } });
    });

    it("accepts exactly the max byte length", () => {
      const value = "a".repeat(MEMO_TEXT_MAX_BYTES);
      expect(validateMemo({ type: "text", value })).toEqual({
        ok: true,
        memo: { type: "text", value },
      });
    });

    it("rejects strings whose UTF-8 length exceeds the max", () => {
      const value = "a".repeat(MEMO_TEXT_MAX_BYTES + 1);
      const result = validateMemo({ type: "text", value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].message).toMatch(/exceeds 28 UTF-8 bytes/);
    });

    it("counts multi-byte chars by bytes, not characters", () => {
      // Each "𝟘" is 4 UTF-8 bytes — eight of them is 32 bytes, over the limit.
      const value = "𝟘".repeat(8);
      const result = validateMemo({ type: "text", value });
      expect(result.ok).toBe(false);
    });

    it("rejects non-string text values", () => {
      const result = validateMemo({ type: "text", value: 123 });
      expect(result.ok).toBe(false);
    });

    it("rejects missing value for text", () => {
      const result = validateMemo({ type: "text" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].message).toMatch(/required/);
    });
  });

  describe("type: id", () => {
    it("accepts a numeric string", () => {
      expect(validateMemo({ type: "id", value: "42" })).toEqual({
        ok: true,
        memo: { type: "id", value: "42" },
      });
    });

    it("accepts a number and normalises to a decimal string", () => {
      expect(validateMemo({ type: "id", value: 7 })).toEqual({
        ok: true,
        memo: { type: "id", value: "7" },
      });
    });

    it("rejects negative ids", () => {
      const result = validateMemo({ type: "id", value: "-1" });
      expect(result.ok).toBe(false);
    });

    it("rejects non-integer ids", () => {
      const result = validateMemo({ type: "id", value: "1.5" });
      expect(result.ok).toBe(false);
    });

    it("rejects ids above uint64 max", () => {
      const result = validateMemo({ type: "id", value: "18446744073709551616" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].message).toMatch(/uint64/);
    });
  });

  describe("type: hash and return", () => {
    const valid = "a".repeat(MEMO_HASH_HEX_LENGTH);

    it("accepts a valid 64-char hex for hash", () => {
      expect(validateMemo({ type: "hash", value: valid })).toEqual({
        ok: true,
        memo: { type: "hash", value: valid },
      });
    });

    it("accepts a valid 64-char hex for return and lowercases it", () => {
      const upper = "F".repeat(MEMO_HASH_HEX_LENGTH);
      expect(validateMemo({ type: "return", value: upper })).toEqual({
        ok: true,
        memo: { type: "return", value: upper.toLowerCase() },
      });
    });

    it("rejects wrong-length hex", () => {
      const result = validateMemo({ type: "hash", value: "abcd" });
      expect(result.ok).toBe(false);
    });

    it("rejects non-hex chars", () => {
      const result = validateMemo({ type: "hash", value: "z".repeat(MEMO_HASH_HEX_LENGTH) });
      expect(result.ok).toBe(false);
    });
  });
});

describe("assertValidMemo", () => {
  it("returns the normalised memo on success", () => {
    expect(assertValidMemo({ type: "text", value: "ok" })).toEqual({
      type: "text",
      value: "ok",
    });
  });

  it("throws MemoValidationError on failure with structured errors", () => {
    expect.assertions(2);
    try {
      assertValidMemo({ type: "hash", value: "nope" });
    } catch (err) {
      expect(err).toBeInstanceOf(MemoValidationError);
      expect((err as MemoValidationError).errors[0].field).toBe("value");
    }
  });
});
