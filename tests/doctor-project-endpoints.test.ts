/**
 * Project-local endpoint detection: scaffold records the chosen
 * horizonUrl/sorobanUrl in .nextellar/config.json, and `doctor` run inside
 * that project defaults to them instead of falling back to testnet.
 */
import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

const mockRunInstall = jest.fn();
jest.unstable_mockModule("../src/lib/install.js", () => ({
  detectPackageManager: () => "npm",
  runInstall: mockRunInstall,
}));

const mockExeca = jest.fn();
jest.unstable_mockModule("execa", () => ({ execa: mockExeca }));
jest.unstable_mockModule("../src/lib/preflight.js", () => ({
  runPreflight: async () => ({ ok: true, failures: [] }),
  setPreflightDisabledForTest: () => {},
  setNpmRunnerForTest: () => {},
  checkNodeVersion: () => ({ ok: true, detail: "test", fix: "" }),
  checkNpmAvailable: async () => ({ ok: true, detail: "test npm OK", fix: "" }),
}));

const { scaffold } = await import("../src/lib/scaffold");
const { runDoctor, setCommandRunnerForTest, setFreeMemoryProviderForTest } =
  await import("../src/lib/doctor.js");

jest.setTimeout(30000);

const CUSTOM_HORIZON = "https://horizon.custom.example";
const CUSTOM_SOROBAN = "https://soroban.custom.example";
const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const TESTNET_SOROBAN = "https://soroban-testnet.stellar.org";

describe("doctor project-local endpoint detection", () => {
  const originalCwd = process.cwd();
  const originalFetch = global.fetch;
  let parent: string;
  let fetchMock: jest.Mock;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockRunInstall.mockImplementation(async () => ({
      success: true,
      packageManager: "skipped",
    }));
    mockExeca.mockImplementation(async () => ({}));
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-doctor-"));
    process.chdir(parent);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    setCommandRunnerForTest(async () => ({ ok: true, out: "v20.10.0" }));
    setFreeMemoryProviderForTest(() => 4_000_000_000);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    global.fetch = originalFetch;
    setCommandRunnerForTest(undefined);
    setFreeMemoryProviderForTest(undefined);
    logSpy.mockRestore();
    jest.restoreAllMocks();
    await fs.remove(parent);
  });

  const fetchedUrls = () => fetchMock.mock.calls.map((args) => args[0]);

  it("scaffold records the chosen URLs in .nextellar/config.json", async () => {
    await scaffold({
      appName: "custom-app",
      useTs: true,
      skipInstall: true,
      horizonUrl: CUSTOM_HORIZON,
      sorobanUrl: CUSTOM_SOROBAN,
    });

    const config = await fs.readJson(
      path.join(parent, "custom-app", ".nextellar", "config.json"),
    );
    expect(config.horizonUrl).toBe(CUSTOM_HORIZON);
    expect(config.sorobanUrl).toBe(CUSTOM_SOROBAN);
  });

  it("scaffold records the testnet defaults when no URLs are chosen", async () => {
    await scaffold({ appName: "default-app", useTs: true, skipInstall: true });

    const config = await fs.readJson(
      path.join(parent, "default-app", ".nextellar", "config.json"),
    );
    expect(config.horizonUrl).toBe(TESTNET_HORIZON);
    expect(config.sorobanUrl).toBe(TESTNET_SOROBAN);
  });

  it("doctor inside a scaffolded project checks the project endpoints", async () => {
    await scaffold({
      appName: "custom-app",
      useTs: true,
      skipInstall: true,
      horizonUrl: CUSTOM_HORIZON,
      sorobanUrl: CUSTOM_SOROBAN,
    });
    process.chdir(path.join(parent, "custom-app"));

    await runDoctor({ json: true });

    expect(fetchedUrls()).toEqual(
      expect.arrayContaining([CUSTOM_HORIZON, CUSTOM_SOROBAN]),
    );
    expect(fetchedUrls()).not.toContain(TESTNET_HORIZON);
    expect(fetchedUrls()).not.toContain(TESTNET_SOROBAN);
  });

  it("explicit flags still win over the project config", async () => {
    await scaffold({
      appName: "custom-app",
      useTs: true,
      skipInstall: true,
      horizonUrl: CUSTOM_HORIZON,
      sorobanUrl: CUSTOM_SOROBAN,
    });
    process.chdir(path.join(parent, "custom-app"));

    await runDoctor({
      json: true,
      horizonUrl: "https://horizon.flag.example",
    });

    expect(fetchedUrls()).toEqual(
      expect.arrayContaining(["https://horizon.flag.example", CUSTOM_SOROBAN]),
    );
    expect(fetchedUrls()).not.toContain(CUSTOM_HORIZON);
  });

  it("doctor outside a project falls back to testnet", async () => {
    await runDoctor({ json: true });

    expect(fetchedUrls()).toEqual(
      expect.arrayContaining([TESTNET_HORIZON, TESTNET_SOROBAN]),
    );
  });
});
