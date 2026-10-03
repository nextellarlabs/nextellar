import {
  PROJECT_CONFIG_SCHEMA_VERSION,
  validateProjectConfig,
} from "../../src/lib/project-config";

const valid = {
  schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
  nextellarVersion: "1.1.0",
  template: "default",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("project config schema", () => {
  it("accepts the current version", () =>
    expect(validateProjectConfig(valid)).toMatchObject(valid));
  it("rejects missing or unsupported schema versions", () => {
    expect(() => validateProjectConfig({ ...valid, schemaVersion: 0 })).toThrow(
      /schemaVersion/,
    );
    expect(() =>
      validateProjectConfig({ ...valid, schemaVersion: undefined }),
    ).toThrow(/schemaVersion/);
  });
});
