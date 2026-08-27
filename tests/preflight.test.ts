// Tests for preflight toolchain checks (#908).

import { checkNodeVersion, runPreflight } from '../src/lib/preflight.js';


describe("checkNodeVersion (#908)", () => {
  // The running node satisfies >= 20, so the happy path is real.
  test("passes on the current toolchain", () => {
    const r = checkNodeVersion(20);
    expect(r.ok).toBe(true);
  });

  test("fails when minimum major is above current", () => {
    const r = checkNodeVersion(999);
    expect(r.ok).toBe(false);
    expect(r.fix).toContain("https://nodejs.org/");
  });
});

describe("runPreflight (#908)", () => {
  test("aggregates failures from both checks", async () => {
    const result = await runPreflight(
      async () => ({ stdout: "" }), // npm missing
      999, // impossible node version
    );
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBe(2);
    expect(result.failures[0]).toContain("Node");
    expect(result.failures[1]).toContain("npm");
  });

  test("passes with healthy toolchain", async () => {
    const result = await runPreflight(
      async () => ({ stdout: "10.9.0\n" }),
      20,
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
  });
});
