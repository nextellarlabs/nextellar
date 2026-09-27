import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

jest.unstable_mockModule("@clack/prompts", () => ({
  __esModule: true,
  intro: jest.fn(),
  outro: jest.fn(),
  isCancel: jest.fn(),
  select: jest.fn(),
  text: jest.fn(),
  multiselect: jest.fn(),
}));

const { intro, isCancel, select, text, multiselect } =
  await import("@clack/prompts");
const { runInit } = await import("../src/lib/init.js");

const mockedSelect = select as unknown as jest.Mock;
const mockedText = text as unknown as jest.Mock;
const mockedMultiselect = multiselect as unknown as jest.Mock;
const mockedIsCancel = isCancel as unknown as jest.Mock;

describe("runInit", () => {
  const tmpDirs: string[] = [];

  const makeProject = async (existing: Record<string, unknown> = {}) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-init-"));
    tmpDirs.push(dir);
    await fs.outputJson(path.join(dir, ".nextellar/config.json"), {
      template: "default",
      nextellarVersion: "1.1.0",
      ...existing,
    });
    return dir;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsCancel.mockReturnValue(false);
    mockedSelect.mockResolvedValue("testnet");
    mockedMultiselect.mockResolvedValue(["freighter"]);
  });

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
    tmpDirs.length = 0;
  });

  it("throws when the target directory is not a Nextellar project", async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-init-notaproject-"),
    );
    tmpDirs.push(dir);

    await expect(runInit({ cwd: dir })).rejects.toThrow(
      "Not a Nextellar project: missing .nextellar/config.json",
    );
  });

  describe("defaults mode (non-interactive)", () => {
    it("writes testnet defaults and freighter when the project has no prior network config", async () => {
      const dir = await makeProject();

      const result = await runInit({ cwd: dir, defaults: true });

      expect(select).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      expect(multiselect).not.toHaveBeenCalled();
      expect(result).toEqual({
        configPath: path.join(dir, ".nextellar/config.json"),
        horizonUrl: "https://horizon-testnet.stellar.org",
        sorobanUrl: "https://soroban-testnet.stellar.org",
        wallets: ["freighter"],
      });

      const written = await fs.readJson(
        path.join(dir, ".nextellar/config.json"),
      );
      expect(written.horizonUrl).toBe("https://horizon-testnet.stellar.org");
      expect(written.sorobanUrl).toBe("https://soroban-testnet.stellar.org");
      expect(written.wallets).toEqual(["freighter"]);
      // Existing fields (template, nextellarVersion) must survive the update.
      expect(written.template).toBe("default");
      expect(written.nextellarVersion).toBe("1.1.0");
    });

    it("preserves an existing network/wallet config rather than overwriting with testnet", async () => {
      const dir = await makeProject({
        horizonUrl: "https://horizon.stellar.org",
        sorobanUrl: "https://soroban.stellar.org",
        wallets: ["albedo", "lobstr"],
      });

      const result = await runInit({ cwd: dir, defaults: true });

      expect(result?.horizonUrl).toBe("https://horizon.stellar.org");
      expect(result?.sorobanUrl).toBe("https://soroban.stellar.org");
      expect(result?.wallets).toEqual(["albedo", "lobstr"]);
    });
  });

  describe("interactive mode", () => {
    it("writes mainnet URLs when mainnet is selected", async () => {
      mockedSelect.mockResolvedValue("mainnet");
      const dir = await makeProject();

      const result = await runInit({ cwd: dir });

      expect(intro).toHaveBeenCalled();
      expect(result?.horizonUrl).toBe("https://horizon.stellar.org");
      expect(result?.sorobanUrl).toBe("https://soroban.stellar.org");

      const written = await fs.readJson(
        path.join(dir, ".nextellar/config.json"),
      );
      expect(written.horizonUrl).toBe("https://horizon.stellar.org");
    });

    it("prompts for custom URLs when 'custom' is selected", async () => {
      mockedSelect.mockResolvedValue("custom");
      mockedText.mockImplementation((options: { message?: string }) => {
        if (options?.message === "Horizon URL") {
          return Promise.resolve("https://my-horizon.example.com");
        }
        return Promise.resolve("https://my-soroban.example.com");
      });
      const dir = await makeProject();

      const result = await runInit({ cwd: dir });

      expect(result?.horizonUrl).toBe("https://my-horizon.example.com");
      expect(result?.sorobanUrl).toBe("https://my-soroban.example.com");
    });

    it("returns null and does not touch config.json when the network prompt is cancelled", async () => {
      mockedIsCancel.mockReturnValue(true);
      const dir = await makeProject({
        horizonUrl: "https://horizon.stellar.org",
      });

      const result = await runInit({ cwd: dir });

      expect(result).toBeNull();
      const written = await fs.readJson(
        path.join(dir, ".nextellar/config.json"),
      );
      expect(written.horizonUrl).toBe("https://horizon.stellar.org");
      expect(written.wallets).toBeUndefined();
    });

    it("writes the selected wallet adapters", async () => {
      mockedMultiselect.mockResolvedValue(["xbull", "hana"]);
      const dir = await makeProject();

      const result = await runInit({ cwd: dir });

      expect(result?.wallets).toEqual(["xbull", "hana"]);
    });

    it("falls back to freighter when no wallets are selected", async () => {
      mockedMultiselect.mockResolvedValue([]);
      const dir = await makeProject();

      const result = await runInit({ cwd: dir });

      expect(result?.wallets).toEqual(["freighter"]);
    });
  });
});
