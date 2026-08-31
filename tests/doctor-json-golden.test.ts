/**
 * Golden test for `nextellar doctor --json` (schema v2).
 *
 * Unlike doctor-json.test.ts (which asserts the *shape* — field names and
 * types — of whatever the current environment produces), this test pins
 * down the *exact* output for a fully deterministic, healthy toolchain and
 * diffs it byte-for-byte against a checked-in fixture
 * (tests/__fixtures__/doctor-json-v2.golden.json).
 *
 * Every check that would otherwise depend on the host machine (subprocess
 * version checks, free RAM, network reachability) is stubbed via the
 * existing test seams (setCommandRunnerForTest / setFreeMemoryProviderForTest)
 * and a mocked `fetch`, so the captured output is reproducible on any
 * machine and in CI.
 *
 * If `runDoctor`'s JSON output ever changes — a field renamed, added,
 * removed, or reordered, a value's formatting changed, etc. — this test
 * fails until the fixture is deliberately updated. That forced review step
 * is the point: it stops the documented v2 consumer contract
 * (docs/doctor-json.md) from drifting out from under CI consumers silently.
 *
 * Updating the fixture on a deliberate, intentional change:
 *   1. Update src/lib/doctor.ts and docs/doctor-json.md together.
 *   2. Run `UPDATE_DOCTOR_GOLDEN=1 npx jest tests/doctor-json-golden.test.ts`
 *      to regenerate tests/__fixtures__/doctor-json-v2.golden.json from the
 *      new output, then inspect the diff before committing it.
 *   3. If the shape changed in a breaking way, bump DOCTOR_JSON_SCHEMA_VERSION
 *      in src/lib/doctor.ts per the versioning policy in docs/doctor-json.md.
 */
import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  runDoctor,
  setCommandRunnerForTest,
  setFreeMemoryProviderForTest,
  type CommandRunner,
} from "../src/lib/doctor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  "__fixtures__",
  "doctor-json-v2.golden.json",
);

// A fully healthy, deterministic toolchain — every check must resolve to a
// fixed, machine-independent value so the captured JSON is reproducible.
const HEALTHY: Record<string, { ok: boolean; out: string }> = {
  "node --version": { ok: true, out: "v20.10.0" },
  "npm --version": { ok: true, out: "10.2.3" },
  "yarn --version": { ok: true, out: "1.22.19" },
  "pnpm --version": { ok: true, out: "8.10.0" },
  "git --version": { ok: true, out: "git version 2.42.0" },
  "rustc --version": { ok: true, out: "rustc 1.73.0" },
  "stellar --version": { ok: true, out: "stellar-cli 20.0.0" },
  "rustup target list --installed": {
    ok: true,
    out: "wasm32-unknown-unknown\nx86_64-apple-darwin",
  },
};

function healthyRunner(): CommandRunner {
  return async (cmd: string) =>
    HEALTHY[cmd] ?? { ok: false, out: "command not found" };
}

describe("doctor --json golden output (schema v2)", () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  let actual: unknown;

  beforeAll(async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    // Fixed at exactly 4,000,000,000 bytes so the rendered "MB free" detail
    // string is a stable, checked-in value (3815 MB) rather than depending
    // on whatever RAM happens to be free on the machine running the test.
    setFreeMemoryProviderForTest(() => 4_000_000_000);
    setCommandRunnerForTest(healthyRunner());

    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runDoctor({
        json: true,
        horizonUrl: "https://horizon-testnet.stellar.org",
        sorobanUrl: "https://soroban-testnet.stellar.org",
      });
      const raw = spy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].trimStart().startsWith("{"),
      );
      if (!raw) throw new Error("doctor --json produced no JSON output");
      actual = JSON.parse(raw[0] as string);
    } finally {
      spy.mockRestore();
    }

    if (process.env.UPDATE_DOCTOR_GOLDEN === "1") {
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(actual, null, 2) + "\n");
    }
  }, 30_000);

  afterAll(() => {
    global.fetch = originalFetch;
    console.log = originalLog;
    setCommandRunnerForTest(undefined);
    setFreeMemoryProviderForTest(undefined);
  });

  it("matches the checked-in golden fixture exactly", () => {
    const golden = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
    expect(actual).toEqual(golden);
  });

  it("fixture itself is schema v2", () => {
    const golden = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
    expect(golden.schemaVersion).toBe(2);
  });
});
