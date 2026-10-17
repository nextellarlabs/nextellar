import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  MEMO_TEXT_MAX_BYTES,
  MEMO_TYPES,
  toStellarMemo,
  validateMemo,
} from "../../src/templates/default/src/lib/memo";

const HASH = "a".repeat(64);
const source = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 21));

function paymentWithMemo(memo: ReturnType<typeof toStellarMemo>) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).addOperation(
    Operation.payment({
      destination: source.publicKey(),
      asset: Asset.native(),
      amount: "1",
    }),
  );
  if (memo) builder.addMemo(memo);
  return builder.setTimeout(30).build();
}

describe("memo (#951)", () => {
  it("exposes the five memo types in selector order", () => {
    expect(MEMO_TYPES).toEqual(["none", "text", "id", "hash", "return"]);
  });

  describe("validateMemo", () => {
    it.each([
      ["none", ""],
      ["text", ""],
      ["text", "rent"],
      ["text", "x".repeat(MEMO_TEXT_MAX_BYTES)],
      ["id", "0"],
      ["id", "18446744073709551615"],
      ["hash", HASH],
      ["hash", HASH.toUpperCase()],
      ["return", "0123456789abcdef".repeat(4)],
    ] as const)("accepts %s memo %p", (type, value) => {
      expect(validateMemo(type, value)).toBeNull();
    });

    it.each([
      ["none", "x", /None/],
      ["text", "x".repeat(29), /29 bytes/],
      // 15 x 2-byte characters = 30 bytes, although only 15 characters.
      ["text", "é".repeat(15), /30 bytes/],
      ["id", "abc", /whole number/],
      ["id", "-1", /whole number/],
      ["id", "1.5", /whole number/],
      ["id", "007", /leading zeros/],
      ["id", "18446744073709551616", /64-bit/],
      ["hash", "a".repeat(63), /64 hexadecimal/],
      ["hash", "g".repeat(64), /64 hexadecimal/],
      ["return", "", /Return memo/],
    ] as const)("rejects %s memo %p", (type, value, message) => {
      expect(validateMemo(type, value)).toMatch(message);
    });
  });

  describe("toStellarMemo", () => {
    it("treats a plain string as a text memo (backwards compatible)", () => {
      const memo = toStellarMemo("rent");
      expect(memo?.type).toBe("text");
      expect(memo?.value?.toString()).toBe("rent");
    });

    it.each([
      undefined,
      "",
      { type: "none" as const, value: "" },
      { type: "text" as const, value: "" },
    ])("returns undefined for no memo (%p)", (input) => {
      expect(toStellarMemo(input)).toBeUndefined();
    });

    it("builds id, hash and return memos", () => {
      const id = toStellarMemo({ type: "id", value: "12345" });
      expect(id?.type).toBe("id");
      expect(id?.value).toBe("12345");
      const hash = toStellarMemo({ type: "hash", value: HASH.toUpperCase() });
      expect(hash?.type).toBe("hash");
      expect(Buffer.from(hash?.value as Buffer).toString("hex")).toBe(HASH);
      const ret = toStellarMemo({ type: "return", value: HASH });
      expect(ret?.type).toBe("return");
    });

    it("throws the validation message for an invalid memo", () => {
      expect(() => toStellarMemo({ type: "id", value: "nope" })).toThrow(
        /whole number/,
      );
      expect(() => toStellarMemo("x".repeat(40))).toThrow(/40 bytes/);
    });
  });

  describe("memo in the built transaction", () => {
    it.each([
      [{ type: "text" as const, value: "invoice 42" }, "text"],
      [{ type: "id" as const, value: "9007199254740993" }, "id"],
      [{ type: "hash" as const, value: HASH }, "hash"],
      [{ type: "return" as const, value: HASH }, "return"],
    ])("survives an XDR round trip (%p)", (input, expectedType) => {
      const tx = paymentWithMemo(toStellarMemo(input));
      const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
      expect(decoded.memo.type).toBe(expectedType);
      const value = decoded.memo.value;
      const asText = Buffer.isBuffer(value)
        ? value.toString(expectedType === "text" ? "utf8" : "hex")
        : String(value);
      expect(asText).toBe(input.value);
    });

    it("adds no memo when none is set", () => {
      expect(paymentWithMemo(toStellarMemo(undefined)).memo.type).toBe("none");
    });
  });
});
