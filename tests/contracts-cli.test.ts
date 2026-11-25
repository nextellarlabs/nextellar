import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

const mockExeca = jest.fn();
jest.unstable_mockModule("execa", () => ({ execa: mockExeca }));

const mockCheckStellarCli = jest.fn();
jest.unstable_mockModule("../src/lib/doctor.js", () => ({
  checkStellarCli: mockCheckStellarCli,
}));

const {
  runContractsBuild,
  runContractsDeploy,
  runContractsInvoke,
  readContractsConfig,
  assertStellarCli,
} = await import("../src/lib/contracts-cli.js");

describe("contracts CLI wrappers (#1490)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-contracts-")),
    );
    mockExeca.mockReset();
    mockCheckStellarCli.mockReset();
    mockCheckStellarCli.mockResolvedValue({
      id: "stellar-cli",
      ok: true,
      name: "Stellar CLI",
      detail: "stellar 21.0.0",
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tmpDir);
  });

  test("fails fast when Stellar CLI is missing", async () => {
    mockCheckStellarCli.mockResolvedValueOnce({
      id: "stellar-cli",
      ok: false,
      name: "Stellar CLI",
      fix: "Install: cargo install stellar-cli",
    });

    await expect(assertStellarCli()).rejects.toThrow(
      /Stellar CLI is not installed/,
    );
  });

  test("readContractsConfig reads network and identity from .nextellar/config.json", async () => {
    const configDir = path.join(tmpDir, ".nextellar");
    await fs.ensureDir(configDir);
    await fs.writeJson(path.join(configDir, "config.json"), {
      schemaVersion: 1,
      network: "public",
      identity: "bob",
    });

    const config = await readContractsConfig(tmpDir);
    expect(config.network).toBe("public");
    expect(config.identity).toBe("bob");
  });

  test("runContractsBuild executes stellar contract build in contracts dir", async () => {
    const contractsDir = path.join(tmpDir, "contracts");
    await fs.ensureDir(contractsDir);

    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "" } as any);

    const result = await runContractsBuild({ cwd: tmpDir });
    expect(result.success).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith(
      "stellar",
      ["contract", "build"],
      expect.objectContaining({ cwd: contractsDir }),
    );
  });

  test("runContractsDeploy deploys wasm and writes contract ID to .env.local", async () => {
    const wasmDir = path.join(
      tmpDir,
      "contracts",
      "target",
      "wasm32-unknown-unknown",
      "release",
    );
    await fs.ensureDir(wasmDir);
    const wasmFile = path.join(wasmDir, "test.wasm");
    await fs.writeFile(wasmFile, "dummy wasm");

    const deployedId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    mockExeca.mockResolvedValueOnce({
      stdout: deployedId,
      stderr: "",
    } as any);

    const res = await runContractsDeploy({
      cwd: tmpDir,
      network: "testnet",
      source: "alice",
    });

    expect(res.contractId).toBe(deployedId);
    expect(mockExeca).toHaveBeenCalledWith("stellar", [
      "contract",
      "deploy",
      "--wasm",
      wasmFile,
      "--source",
      "alice",
      "--network",
      "testnet",
    ]);

    const envContent = await fs.readFile(path.join(tmpDir, ".env.local"), "utf8");
    expect(envContent).toContain(`NEXT_PUBLIC_CONTRACT_ID=${deployedId}`);
  });

  test("runContractsInvoke invokes contract function with arguments", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '"hello world"',
      stderr: "",
    } as any);

    const res = await runContractsInvoke({
      cwd: tmpDir,
      id: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      fn: "hello",
      args: ["--to", "alice"],
      network: "testnet",
      source: "alice",
    });

    expect(res.result).toBe('"hello world"');
    expect(mockExeca).toHaveBeenCalledWith("stellar", [
      "contract",
      "invoke",
      "--id",
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "--source",
      "alice",
      "--network",
      "testnet",
      "--",
      "hello",
      "--to",
      "alice",
    ]);
  });
});
