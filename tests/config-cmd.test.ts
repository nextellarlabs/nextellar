import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  getConfigValue,
  parseConfigValue,
  parseKeyPath,
  runConfig,
  setConfigValue,
} from "../src/lib/config-cmd";

// #1484 — `nextellar config get|set|list`.
const baseConfig = () => ({
  schemaVersion: 1,
  nextellarVersion: "1.2.3",
  template: "default",
  createdAt: "2026-01-01T00:00:00.000Z",
  horizonUrl: "https://horizon-testnet.stellar.org",
  wallets: ["freighter"],
  custom: { nested: { flag: false } },
});

describe("parseKeyPath", () => {
  it("splits dotted paths", () => {
    expect(parseKeyPath("custom.nested.flag")).toEqual([
      "custom",
      "nested",
      "flag",
    ]);
  });

  it("rejects empty keys, empty segments and prototype segments", () => {
    expect(() => parseKeyPath(undefined)).toThrow(/key is required/);
    expect(() => parseKeyPath("a..b")).toThrow(/empty path segment/);
    expect(() => parseKeyPath("__proto__.polluted")).toThrow(/not allowed/);
    expect(() => parseKeyPath("constructor")).toThrow(/not allowed/);
  });
});

describe("getConfigValue", () => {
  it("reads top-level and nested values", () => {
    expect(getConfigValue(baseConfig(), "template")).toEqual({
      found: true,
      value: "default",
    });
    expect(getConfigValue(baseConfig(), "custom.nested.flag")).toEqual({
      found: true,
      value: false,
    });
  });

  it("reports missing keys, including through a non-object", () => {
    expect(getConfigValue(baseConfig(), "nope").found).toBe(false);
    expect(getConfigValue(baseConfig(), "template.deeper").found).toBe(false);
    expect(getConfigValue(baseConfig(), "toString").found).toBe(false);
  });
});

describe("parseConfigValue", () => {
  it("parses JSON when it can and keeps plain strings otherwise", () => {
    expect(parseConfigValue("true")).toBe(true);
    expect(parseConfigValue("42")).toBe(42);
    expect(parseConfigValue('["a","b"]')).toEqual(["a", "b"]);
    expect(parseConfigValue("https://example.org")).toBe("https://example.org");
  });
});

describe("setConfigValue", () => {
  it("sets a known key and returns the previous value without mutating the input", () => {
    const input = baseConfig();
    const result = setConfigValue(input, "horizonUrl", "https://horizon.stellar.org");
    expect(result.config.horizonUrl).toBe("https://horizon.stellar.org");
    expect(result.previous).toBe("https://horizon-testnet.stellar.org");
    expect(input.horizonUrl).toBe("https://horizon-testnet.stellar.org");
  });

  it("accepts a comma-separated or JSON list for wallets", () => {
    expect(setConfigValue(baseConfig(), "wallets", "freighter, xbull").value).toEqual([
      "freighter",
      "xbull",
    ]);
    expect(setConfigValue(baseConfig(), "wallets", '["lobstr"]').value).toEqual(["lobstr"]);
  });

  it("rejects invalid values with the key named", () => {
    expect(() => setConfigValue(baseConfig(), "horizonUrl", "not a url")).toThrow(
      /"horizonUrl".*http\(s\) URL/,
    );
    expect(() => setConfigValue(baseConfig(), "horizonUrl", "ftp://x.org")).toThrow(
      /"horizonUrl"/,
    );
    expect(() => setConfigValue(baseConfig(), "createdAt", "yesterday-ish")).toThrow(
      /"createdAt"/,
    );
    expect(() => setConfigValue(baseConfig(), "wallets", "[1,2]")).toThrow(/"wallets"/);
    expect(() => setConfigValue(baseConfig(), "template", "")).toThrow(/"template"/);
  });

  it("refuses CLI-managed keys", () => {
    expect(() => setConfigValue(baseConfig(), "schemaVersion", "2")).toThrow(
      /managed by nextellar/,
    );
    expect(() => setConfigValue(baseConfig(), "nextellarVersion", "9.9.9")).toThrow(
      /managed by nextellar/,
    );
  });

  it("rejects an unknown key and lists the known ones", () => {
    expect(() => setConfigValue(baseConfig(), "horizonUrll", "https://x.org")).toThrow(
      /Unknown config key "horizonUrll".*horizonUrl/,
    );
  });

  it("edits existing custom keys, including nested ones", () => {
    const result = setConfigValue(baseConfig(), "custom.nested.flag", "true");
    expect((result.config.custom as any).nested.flag).toBe(true);
    expect(result.previous).toBe(false);
  });

  it("refuses to create a path through something that is not an object", () => {
    expect(() => setConfigValue(baseConfig(), "custom.nested.flag.deeper", "1")).toThrow(
      /not an existing object/,
    );
    expect(() => setConfigValue(baseConfig(), "wallets.0", "x")).toThrow(/no nested keys/);
  });
});

describe("runConfig", () => {
  const tmpDirs: string[] = [];
  let logSpy: ReturnType<typeof jest.spyOn>;

  const makeProject = async (config: unknown = baseConfig()): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-config-test-"));
    tmpDirs.push(dir);
    if (config !== null) {
      await fs.outputJson(path.join(dir, ".nextellar", "config.json"), config);
    }
    return dir;
  };

  const logged = () => logSpy.mock.calls.map((c) => String(c[0])).join("\n");

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it("get prints the plain value, or JSON with --json", async () => {
    const cwd = await makeProject();
    await runConfig({ cwd, action: "get", key: "template" });
    expect(logged()).toBe("default");

    logSpy.mockClear();
    await runConfig({ cwd, action: "get", key: "wallets", json: true });
    expect(JSON.parse(logged())).toEqual({ key: "wallets", value: ["freighter"] });
  });

  it("get fails clearly for an unset key", async () => {
    const cwd = await makeProject();
    await expect(runConfig({ cwd, action: "get", key: "sorobanUrl" })).rejects.toThrow(
      /"sorobanUrl" is not set/,
    );
  });

  it("list prints every key, or the whole object with --json", async () => {
    const cwd = await makeProject();
    await runConfig({ cwd, action: "list" });
    expect(logged()).toContain("template: default");
    expect(logged()).toContain('wallets: ["freighter"]');

    logSpy.mockClear();
    await runConfig({ cwd, action: "list", json: true });
    expect(JSON.parse(logged())).toEqual(baseConfig());
  });

  it("set writes the file, keeps other keys, and reports the previous value in JSON", async () => {
    const cwd = await makeProject();
    await runConfig({
      cwd,
      action: "set",
      key: "sorobanUrl",
      value: "https://soroban-testnet.stellar.org",
      json: true,
    });
    expect(JSON.parse(logged())).toEqual({
      key: "sorobanUrl",
      value: "https://soroban-testnet.stellar.org",
    });
    const written = await fs.readJson(path.join(cwd, ".nextellar", "config.json"));
    expect(written.sorobanUrl).toBe("https://soroban-testnet.stellar.org");
    expect(written.template).toBe("default");
    expect(written.custom).toEqual({ nested: { flag: false } });
    // No temp files are left behind.
    expect(await fs.readdir(path.join(cwd, ".nextellar"))).toEqual(["config.json"]);
  });

  it("set leaves the file unchanged when the value is invalid", async () => {
    const cwd = await makeProject();
    await expect(
      runConfig({ cwd, action: "set", key: "horizonUrl", value: "nope" }),
    ).rejects.toThrow(/"horizonUrl"/);
    const after = await fs.readJson(path.join(cwd, ".nextellar", "config.json"));
    expect(after).toEqual(baseConfig());
  });

  it("set requires a value", async () => {
    const cwd = await makeProject();
    await expect(runConfig({ cwd, action: "set", key: "template" })).rejects.toThrow(
      /value is required/,
    );
  });

  it("fails when there is no config file or it is not an object", async () => {
    const empty = await makeProject(null);
    await expect(runConfig({ cwd: empty, action: "list" })).rejects.toThrow(
      /No \.nextellar\/config\.json found/,
    );
    const bad = await makeProject([1, 2, 3]);
    await expect(runConfig({ cwd: bad, action: "list" })).rejects.toThrow(
      /expected an object/,
    );
  });
});
