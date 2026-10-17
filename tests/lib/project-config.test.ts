import {
  migrateProjectConfig,
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

describe("migrateProjectConfig (#907)", () => {
  const FALLBACK = "2025-06-01T12:00:00.000Z";

  it("leaves a current config untouched", () => {
    const result = migrateProjectConfig({ ...valid, wallets: ["freighter"] });
    expect(result).toEqual({
      config: { ...valid, wallets: ["freighter"] },
      fromVersion: 1,
      migrated: false,
      changes: [],
    });
  });

  it("keeps a valid createdAt string exactly as written (no churn)", () => {
    const config = { ...valid, createdAt: "2026-01-15T10:32:00Z" };
    expect(migrateProjectConfig(config).config.createdAt).toBe(
      "2026-01-15T10:32:00Z",
    );
    expect(migrateProjectConfig(config).migrated).toBe(false);
  });

  it("migrates the original unversioned shape scaffolded before schemaVersion", () => {
    const legacy = {
      nextellarVersion: "0.4.2",
      template: "minimal",
      createdAt: "2026-01-15T10:32:00.000Z",
    };
    const result = migrateProjectConfig(legacy);

    expect(result.fromVersion).toBe(0);
    expect(result.migrated).toBe(true);
    expect(result.config).toEqual({
      ...legacy,
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
    });
    expect(result.changes).toEqual([
      `schemaVersion: 0 -> ${PROJECT_CONFIG_SCHEMA_VERSION}`,
    ]);
  });

  it("fills missing fields from legacy aliases and keeps the aliases and unknown keys", () => {
    const legacy = {
      version: "0.3.0",
      templateName: "defi",
      created: 1700000000,
      wallets: "freighter, albedo,,xbull ",
      horizonUrl: "https://horizon-testnet.stellar.org",
    };
    const result = migrateProjectConfig(legacy);

    expect(result.config).toEqual({
      ...legacy,
      schemaVersion: 1,
      nextellarVersion: "0.3.0",
      template: "defi",
      createdAt: "2023-11-14T22:13:20.000Z",
      wallets: ["freighter", "albedo", "xbull"],
    });
    expect(result.changes).toEqual([
      "schemaVersion: 0 -> 1",
      'nextellarVersion: copied from legacy "version"',
      'template: copied from legacy "templateName"',
      'createdAt: copied from legacy "created"',
      "wallets: converted comma-separated string to a list",
    ]);
  });

  it("accepts epoch milliseconds and the other createdAt aliases", () => {
    expect(
      migrateProjectConfig({ createdAt: 1700000000000 }).config.createdAt,
    ).toBe("2023-11-14T22:13:20.000Z");
    expect(
      migrateProjectConfig({ created_at: "2024-02-03" }).config.createdAt,
    ).toBe("2024-02-03T00:00:00.000Z");
  });

  it("falls back to defaults and the given time when nothing can be recovered", () => {
    const result = migrateProjectConfig({}, { fallbackCreatedAt: FALLBACK });
    expect(result.config).toEqual({
      schemaVersion: 1,
      nextellarVersion: "unknown",
      template: "default",
      createdAt: FALLBACK,
    });
  });

  it("replaces an unparseable createdAt with the fallback", () => {
    const result = migrateProjectConfig(
      { ...valid, createdAt: "yesterday-ish" },
      { fallbackCreatedAt: FALLBACK },
    );
    expect(result.config.createdAt).toBe(FALLBACK);
    expect(result.migrated).toBe(true);
  });

  it("repairs an incomplete v1 config instead of rejecting it", () => {
    // e.g. a legacy file that `nextellar init` stamped with schemaVersion 1.
    const result = migrateProjectConfig(
      { schemaVersion: 1, template: "minimal", wallets: ["freighter"] },
      { fallbackCreatedAt: FALLBACK },
    );
    expect(result.migrated).toBe(true);
    expect(result.config).toMatchObject({
      schemaVersion: 1,
      template: "minimal",
      nextellarVersion: "unknown",
      createdAt: FALLBACK,
    });
    expect(result.changes).not.toContain("schemaVersion: 1 -> 1");
  });

  it("round-trips: a migrated config survives JSON and migrates to itself", () => {
    const first = migrateProjectConfig({
      cliVersion: "0.2.0",
      templateId: "js-template",
      createdOn: 1650000000,
    });
    const reread = JSON.parse(JSON.stringify(first.config));
    const second = migrateProjectConfig(reread);

    expect(second.migrated).toBe(false);
    expect(second.changes).toEqual([]);
    expect(second.config).toEqual(first.config);
    expect(validateProjectConfig(reread)).toEqual(first.config);
  });

  it("does not mutate its input", () => {
    const legacy = { template: "default", wallets: "freighter" };
    migrateProjectConfig(legacy, { fallbackCreatedAt: FALLBACK });
    expect(legacy).toEqual({ template: "default", wallets: "freighter" });
  });

  it.each([null, "config", 42, ["a"]])(
    "rejects a non-object config (%p)",
    (input) => {
      expect(() => migrateProjectConfig(input)).toThrow(/expected an object/);
    },
  );

  it.each([-1, 1.5, "1"])(
    "rejects a malformed schemaVersion (%p)",
    (schemaVersion) => {
      expect(() => migrateProjectConfig({ ...valid, schemaVersion })).toThrow(
        /non-negative integer/,
      );
    },
  );

  it("refuses to downgrade a config written by a newer CLI", () => {
    expect(() => migrateProjectConfig({ ...valid, schemaVersion: 99 })).toThrow(
      /schemaVersion 99, but this CLI only understands up to 1/,
    );
  });
});
