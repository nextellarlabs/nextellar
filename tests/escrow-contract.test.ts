import fs from "fs";
import path from "path";
import { CONTRACTS } from "../src/templates/contracts-template/src/lib/contracts/index";

const root = path.join(__dirname, "../src/templates/contracts-template");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("contracts-template escrow example", () => {
  const lib = read("contracts/escrow/src/lib.rs");
  const tests = read("contracts/escrow/src/test.rs");

  it("is a member of the Rust workspace", () => {
    expect(read("contracts/Cargo.toml")).toMatch(/"escrow"/);
    expect(read("contracts/escrow/Cargo.toml")).toContain('name = "escrow"');
  });

  it.each(["initialize", "deposit", "release", "refund", "timeout"])(
    "exposes %s and its spec entry",
    (fn) => {
      expect(lib).toContain(`pub fn ${fn}(`);
      const spec = JSON.parse(read("contracts/escrow/spec.json"));
      expect(spec.functions.map((f: { name: string }) => f.name)).toContain(fn);
    },
  );

  it("has tests for each path and unauthorized calls", () => {
    for (const name of [
      "deposit_moves_funds",
      "release_by_depositor",
      "release_by_arbiter",
      "refund_by_beneficiary",
      "timeout_after_deadline",
      "release_by_beneficiary_or_stranger_is_unauthorized",
      "refund_by_depositor_or_stranger_is_unauthorized",
      "timeout_before_deadline_fails",
      "deposit_without_signature_panics",
    ]) {
      expect(tests).toContain(`fn ${name}`);
    }
  });

  it("registers a contract ID entry and client binding", () => {
    expect(CONTRACTS.ESCROW).toBe("C_REPLACE_WITH_YOUR_CONTRACT_ID");
    expect(read("src/lib/contracts/index.ts")).toContain("EscrowClient");
    expect(read("src/lib/bindings/Escrow.ts")).toContain("class EscrowClient");
  });

  it("is documented with a frontend snippet", () => {
    const readme = read("contracts/README.md");
    expect(readme).toContain("Example: Escrow");
    expect(readme).toContain("new EscrowClient(contract)");
  });
});
