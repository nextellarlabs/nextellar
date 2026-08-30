import {
  CONTRACTS,
  isValidContractId,
  validateContracts,
} from "../src/templates/contracts-template/src/lib/contracts/index";

const VALID_CONTRACT_ID =
  "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const PLACEHOLDER = "C_REPLACE_WITH_YOUR_CONTRACT_ID";

describe("contracts-template contract config", () => {
  describe("isValidContractId", () => {
    it("returns true for a well-formed contract ID", () => {
      expect(isValidContractId(VALID_CONTRACT_ID)).toBe(true);
    });

    it("returns false for the unset scaffold placeholder", () => {
      expect(isValidContractId(PLACEHOLDER)).toBe(false);
    });

    it("returns false for an empty string", () => {
      expect(isValidContractId("")).toBe(false);
    });
  });

  describe("CONTRACTS", () => {
    it("falls back to the placeholder when the env vars are unset", () => {
      expect(CONTRACTS.HELLO_WORLD).toBe(PLACEHOLDER);
      expect(CONTRACTS.COUNTER).toBe(PLACEHOLDER);
    });
  });

  describe("validateContracts", () => {
    it("throws a descriptive error naming the offending env var when contracts are unset", () => {
      expect(() => validateContracts()).toThrow(
        "NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID",
      );
    });

    it("throws for the unset placeholder, not a generic message", () => {
      expect(() => validateContracts()).toThrow(
        /is not set — using the unset placeholder/,
      );
    });
  });
});
