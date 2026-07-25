/**
 * Shape/contract test for `nextellar doctor --json`.
 *
 * Documented in docs/doctor-json.md. Fails when a required field is renamed,
 * removed, or a new top-level field appears without a schema bump.
 */
import { runDoctor, DOCTOR_JSON_SCHEMA_VERSION } from "../src/lib/doctor.js";

describe("doctor --json output shape", () => {
  let output: any;

  beforeAll(async () => {
    // Capture the single console.log call made by runDoctor({ json: true }).
    // Use jest.spyOn so the spy is always cleaned up, even on failure.
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runDoctor({ json: true });
      // The first call arg is the JSON string.
      const raw = spy.mock.calls.find((c) => typeof c[0] === "string" && c[0].trimStart().startsWith("{"));
      if (!raw) throw new Error("doctor --json produced no JSON output");
      output = JSON.parse(raw[0] as string);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);

  it("has schemaVersion equal to DOCTOR_JSON_SCHEMA_VERSION", () => {
    expect(output.schemaVersion).toBe(DOCTOR_JSON_SCHEMA_VERSION);
    expect(output.schemaVersion).toBe(1);
  });

  it("has top-level summary fields with correct types", () => {
    expect(typeof output.passed).toBe("number");
    expect(typeof output.failed).toBe("number");
    expect(typeof output.requiredFailures).toBe("number");
  });

  it("has a non-empty checks array", () => {
    expect(Array.isArray(output.checks)).toBe(true);
    expect(output.checks.length).toBeGreaterThan(0);
  });

  it("every check has required fields with correct types", () => {
    for (const check of output.checks) {
      expect(typeof check.id).toBe("string");
      expect(typeof check.name).toBe("string");
      expect(typeof check.required).toBe("boolean");
      expect(typeof check.ok).toBe("boolean");
    }
  });

  it("optional check fields are strings when present", () => {
    for (const check of output.checks) {
      if (check.detail !== undefined) expect(typeof check.detail).toBe("string");
      if (check.fix !== undefined) expect(typeof check.fix).toBe("string");
      if (check.link !== undefined) expect(typeof check.link).toBe("string");
    }
  });

  it("top-level shape has exactly the expected keys", () => {
    const keys = Object.keys(output).sort();
    expect(keys).toEqual(["checks", "failed", "passed", "requiredFailures", "schemaVersion"]);
  });

  it("each check has no unexpected keys", () => {
    const allowed = new Set(["id", "name", "required", "ok", "detail", "fix", "link"]);
    for (const check of output.checks) {
      for (const key of Object.keys(check)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it("passed + failed equals checks.length", () => {
    expect(output.passed + output.failed).toBe(output.checks.length);
  });

  it("requiredFailures matches check data", () => {
    const expected = output.checks.filter((c: any) => c.required && !c.ok).length;
    expect(output.requiredFailures).toBe(expected);
  });
});
