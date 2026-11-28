import os from "os";
import path from "path";
import fs from "fs-extra";
import { jest } from "@jest/globals";
import {
  parseWorkspaceMembers,
  registerWorkspaceMember,
  runAddContract,
  toPascalCase,
  validateContractName,
} from "../src/lib/add-contract.js";

describe("add-contract", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-add-contract-"),
    );
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tmpDir);
  });

  async function initProject(options?: {
    withWorkspace?: boolean;
    withConfig?: boolean;
  }) {
    await fs.writeJson(path.join(tmpDir, "package.json"), {
      name: "test-app",
      version: "0.1.0",
      scripts: {},
    });

    if (options?.withWorkspace) {
      await fs.ensureDir(path.join(tmpDir, "contracts"));
      await fs.writeFile(
        path.join(tmpDir, "contracts", "Cargo.toml"),
        `[workspace]\nresolver = "2"\nmembers = [\n    "hello_world"\n]\n\n[profile.release]\nopt-level = "z"\n`,
        "utf8",
      );
    }

    if (options?.withConfig) {
      await fs.ensureDir(path.join(tmpDir, ".nextellar"));
      await fs.writeJson(path.join(tmpDir, ".nextellar", "config.json"), {
        schemaVersion: 1,
        nextellarVersion: "1.1.0",
        template: "default",
        createdAt: "2026-01-01T00:00:00.000Z",
        wallets: ["freighter"],
      });
    }
  }

  describe("validateContractName", () => {
    it("accepts valid snake_case names", () => {
      expect(validateContractName("token")).toBeNull();
      expect(validateContractName("my_token")).toBeNull();
      expect(validateContractName("escrow_v2")).toBeNull();
    });

    it("rejects empty, whitespace, uppercase, hyphens, and path traversal", () => {
      expect(validateContractName("")).toMatch(/required/i);
      expect(validateContractName("   ")).toMatch(/required/i);
      expect(validateContractName(" my_token")).toMatch(/whitespace/i);
      expect(validateContractName("MyToken")).toMatch(/snake_case/i);
      expect(validateContractName("my-token")).toMatch(/snake_case/i);
      expect(validateContractName("123_token")).toMatch(/snake_case/i);
      expect(validateContractName("../evil")).toMatch(/snake_case/i);
      expect(validateContractName("my__token")).toMatch(/consecutive/i);
      expect(validateContractName("my_token_")).toMatch(/underscore/i);
      expect(validateContractName("a".repeat(65))).toMatch(/at most 64/i);
    });

    it("rejects reserved Rust keywords", () => {
      expect(validateContractName("fn")).toMatch(/reserved Rust keyword/i);
      expect(validateContractName("struct")).toMatch(/reserved Rust keyword/i);
      expect(validateContractName("match")).toMatch(/reserved Rust keyword/i);
    });
  });

  describe("toPascalCase", () => {
    it("converts snake_case to PascalCase", () => {
      expect(toPascalCase("token")).toBe("Token");
      expect(toPascalCase("my_token")).toBe("MyToken");
      expect(toPascalCase("escrow_v2")).toBe("EscrowV2");
    });
  });

  describe("workspace Cargo.toml helpers", () => {
    it("parses and registers a new member preserving existing members", () => {
      const toml = `[workspace]\nresolver = "2"\nmembers = [\n    "hello_world"\n]\n`;
      expect(parseWorkspaceMembers(toml)).toEqual(["hello_world"]);

      const updated = registerWorkspaceMember(toml, "my_token");
      expect(parseWorkspaceMembers(updated)).toEqual([
        "hello_world",
        "my_token",
      ]);
    });

    it("throws when registering a duplicate member", () => {
      const toml = `[workspace]\nmembers = ["hello_world"]\n`;
      expect(() => registerWorkspaceMember(toml, "hello_world")).toThrow(
        /already registered/i,
      );
    });
  });

  describe("runAddContract — success cases", () => {
    it("scaffolds contract, registers in Cargo workspace, updates config.json, and generates bindings, hook, and docs", async () => {
      await initProject({ withWorkspace: true, withConfig: true });

      const result = await runAddContract("my_token", { cwd: tmpDir });

      expect(result.success).toBe(true);
      expect(result.contractName).toBe("my_token");

      // Contract crate files
      const crateCargo = await fs.readFile(
        path.join(tmpDir, "contracts", "my_token", "Cargo.toml"),
        "utf8",
      );
      expect(crateCargo).toContain('name = "my_token"');

      const libRs = await fs.readFile(
        path.join(tmpDir, "contracts", "my_token", "src", "lib.rs"),
        "utf8",
      );
      expect(libRs).toContain("pub struct MyTokenContract;");

      const spec = await fs.readJson(
        path.join(tmpDir, "contracts", "my_token", "spec.json"),
      );
      expect(spec.functions[0].name).toBe("hello");

      // Workspace Cargo.toml updated
      const workspaceToml = await fs.readFile(
        path.join(tmpDir, "contracts", "Cargo.toml"),
        "utf8",
      );
      expect(parseWorkspaceMembers(workspaceToml)).toEqual([
        "hello_world",
        "my_token",
      ]);

      // Generated TS bindings, React hook, and docs
      const bindings = await fs.readFile(
        path.join(tmpDir, "src", "lib", "bindings", "MyToken.ts"),
        "utf8",
      );
      expect(bindings).toContain("export class MyTokenClient");

      const hook = await fs.readFile(
        path.join(tmpDir, "src", "hooks", "useMyTokenContract.ts"),
        "utf8",
      );
      expect(hook).toContain("export function useMyTokenContract");
      expect(hook).toContain("NEXT_PUBLIC_MY_TOKEN_CONTRACT_ID");

      const docs = await fs.readFile(
        path.join(tmpDir, "contracts", "my_token", "README.md"),
        "utf8",
      );
      expect(docs).toContain("# MyToken Contract");
      expect(docs).toContain("useMyTokenContract");

      // .nextellar/config.json updated while preserving existing keys
      const config = await fs.readJson(
        path.join(tmpDir, ".nextellar", "config.json"),
      );
      expect(config.wallets).toEqual(["freighter"]);
      expect(config.contracts).toHaveLength(1);
      expect(config.contracts[0]).toMatchObject({
        name: "my_token",
        path: "contracts/my_token",
        bindings: "src/lib/bindings/MyToken.ts",
        hook: "src/hooks/useMyTokenContract.ts",
        docs: "contracts/my_token/README.md",
        template: "hello",
      });

      // package.json scripts added
      const pkg = await fs.readJson(path.join(tmpDir, "package.json"));
      expect(pkg.scripts["contracts:build"]).toBeDefined();
      expect(pkg.scripts["contracts:test"]).toBeDefined();
    });

    it("supports counter template and initializes workspace/config when absent", async () => {
      await initProject({ withWorkspace: false, withConfig: false });

      const result = await runAddContract("vote_counter", {
        cwd: tmpDir,
        template: "counter",
      });

      expect(result.success).toBe(true);
      const workspaceToml = await fs.readFile(
        path.join(tmpDir, "contracts", "Cargo.toml"),
        "utf8",
      );
      expect(parseWorkspaceMembers(workspaceToml)).toEqual(["vote_counter"]);

      const bindings = await fs.readFile(
        path.join(tmpDir, "src", "lib", "bindings", "VoteCounter.ts"),
        "utf8",
      );
      expect(bindings).toContain("async increment()");
      expect(bindings).toContain("async getCount()");

      const config = await fs.readJson(
        path.join(tmpDir, ".nextellar", "config.json"),
      );
      expect(config.schemaVersion).toBe(1);
      expect(config.contracts[0].name).toBe("vote_counter");
      expect(config.contracts[0].template).toBe("counter");
    });

    it("does not write files in dry-run mode", async () => {
      await initProject({ withWorkspace: true, withConfig: true });

      const result = await runAddContract("dry_contract", {
        cwd: tmpDir,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(
        await fs.pathExists(path.join(tmpDir, "contracts", "dry_contract")),
      ).toBe(false);
      expect(
        await fs.pathExists(
          path.join(tmpDir, "src", "lib", "bindings", "DryContract.ts"),
        ),
      ).toBe(false);
    });
  });

  describe("runAddContract — conflict and error cases", () => {
    it("rejects invalid contract names", async () => {
      await initProject();
      const result = await runAddContract("Invalid-Name", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Invalid contract name/i);
    });

    it("rejects unknown templates", async () => {
      await initProject();
      const result = await runAddContract("my_token", {
        cwd: tmpDir,
        template: "unknown" as "hello",
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Unknown contract template/i);
    });

    it("rejects when package.json is missing", async () => {
      const result = await runAddContract("my_token", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/No package\.json found/i);
    });

    it("rejects duplicate contract directory", async () => {
      await initProject({ withWorkspace: true, withConfig: true });
      await fs.ensureDir(path.join(tmpDir, "contracts", "my_token"));

      const result = await runAddContract("my_token", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already exists/i);
    });

    it("rejects contract already registered in contracts/Cargo.toml", async () => {
      await initProject({ withWorkspace: true, withConfig: true });

      const result = await runAddContract("hello_world", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(
        /already registered in contracts\/Cargo\.toml/i,
      );
    });

    it("rejects contract already registered in .nextellar/config.json", async () => {
      await initProject({ withWorkspace: true, withConfig: true });
      await fs.writeJson(path.join(tmpDir, ".nextellar", "config.json"), {
        schemaVersion: 1,
        nextellarVersion: "1.1.0",
        template: "default",
        createdAt: "2026-01-01T00:00:00.000Z",
        contracts: [{ name: "escrow" }],
      });

      const result = await runAddContract("escrow", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(
        /already registered in \.nextellar\/config\.json/i,
      );
    });

    it("rejects when bindings file already exists", async () => {
      await initProject({ withWorkspace: true, withConfig: true });
      await fs.ensureDir(path.join(tmpDir, "src", "lib", "bindings"));
      await fs.writeFile(
        path.join(tmpDir, "src", "lib", "bindings", "MyToken.ts"),
        "// existing",
      );

      const result = await runAddContract("my_token", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Bindings file .* already exists/i);
    });

    it("rejects when hook file already exists", async () => {
      await initProject({ withWorkspace: true, withConfig: true });
      await fs.ensureDir(path.join(tmpDir, "src", "hooks"));
      await fs.writeFile(
        path.join(tmpDir, "src", "hooks", "useMyTokenContract.ts"),
        "// existing",
      );

      const result = await runAddContract("my_token", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Hook file .* already exists/i);
    });
  });
});
