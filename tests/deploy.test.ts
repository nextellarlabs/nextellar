import { jest } from "@jest/globals";
import type { MockedFunction } from "jest-mock";
import fs from "fs-extra";
import os from "os";
import path from "path";

// Mock execa BEFORE importing deploy.ts (ESM-compatible mocking)
jest.unstable_mockModule("execa", () => ({
  execa: jest.fn(),
}));

// Dynamic imports — must come after the mock registration
const execaModule = await import("execa");
const { runDeploy } = await import("../src/lib/deploy");

const mockExeca = execaModule.execa as MockedFunction<typeof execaModule.execa>;

/** Recursively list all files and directories in `dir`, returning a map
 *  of relative-path → content (or empty string for dirs). */
async function getFileMap(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);
      if (entry.isDirectory()) {
        result[relPath + path.sep] = "";
        await walk(fullPath);
      } else if (entry.isFile()) {
        result[relPath] = await fs.readFile(fullPath, "utf8");
      }
    }
  }

  await walk(dir);
  return result;
}

describe("runDeploy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-deploy-test-")
    );
  });

  afterEach(async () => {
    await fs.remove(tempDir).catch(() => {});
    jest.clearAllMocks();
  });

  // ── Validation failures ──────────────────────────────────────

  it("rejects a directory without package.json", async () => {
    await expect(runDeploy({ cwd: tempDir })).rejects.toThrow(
      "No package.json found in this directory. " +
        "Run this command from a Next.js project root."
    );
  });

  it("rejects a project without a next dependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      name: "no-next-app",
    });

    await expect(runDeploy({ cwd: tempDir })).rejects.toThrow(
      'This is not a Next.js project (missing "next" dependency in package.json).'
    );
  });

  it('rejects when .next/ build output is missing', async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      name: "no-build-app",
      dependencies: { next: "^14.0.0" },
    });

    await expect(runDeploy({ cwd: tempDir })).rejects.toThrow(
      "Missing production build (.next). Run 'npm run build' first."
    );
  });

  // ── Dry-run ──────────────────────────────────────────────────

  it("--dry-run performs no writes (no .nextellar/deploy/ created)", async () => {
    // Set up a valid project
    await fs.writeJson(path.join(tempDir, "package.json"), {
      name: "dry-run-app",
      dependencies: { next: "^14.0.0" },
    });
    await fs.ensureDir(path.join(tempDir, ".next"));

    // Capture byte-identical snapshot before dry-run
    const before = await getFileMap(tempDir);

    await runDeploy({ cwd: tempDir, dryRun: true });

    // No .nextellar/deploy directory should exist
    const deployDir = path.join(tempDir, ".nextellar", "deploy");
    expect(await fs.pathExists(deployDir)).toBe(false);

    // Fixture directory is byte-identical
    const after = await getFileMap(tempDir);
    expect(after).toEqual(before);

    // execa (tar) was never called
    expect(mockExeca).not.toHaveBeenCalled();
  });

  // ── Success (with mocked tar) ────────────────────────────────

  it("on success, latest-bundle.json contains bundlePath, bundleSizeBytes, hasContracts, createdAt", async () => {
    // Set up a valid project
    await fs.writeJson(path.join(tempDir, "package.json"), {
      name: "success-app",
      dependencies: { next: "^14.0.0" },
    });
    await fs.ensureDir(path.join(tempDir, ".next"));

    // Also add a contracts dir so hasContracts = true
    await fs.ensureDir(path.join(tempDir, "contracts"));
    await fs.writeFile(
      path.join(tempDir, "contracts", "hello.sol"),
      "// stub"
    );

    // Mock execa("tar", ...) to create a realistic mock bundle file
    mockExeca.mockImplementation(
      async (command: string, args: readonly string[]) => {
        if (command === "tar") {
          // args[1] is the bundle output path (-czf bundlePath ...)
          const bundlePath = args[1];
          await fs.ensureDir(path.dirname(bundlePath));
          // Write a known payload so fs.stat gives a deterministic size
          await fs.writeFile(bundlePath, "mock-tar-bundle-payload");
          return { stdout: "", stderr: "" } as any;
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    );

    const beforeDeploy = Date.now();

    await runDeploy({ cwd: tempDir });

    // latest-bundle.json was written
    const statePath = path.join(
      tempDir,
      ".nextellar",
      "deploy",
      "latest-bundle.json"
    );
    expect(await fs.pathExists(statePath)).toBe(true);

    const state = (await fs.readJson(statePath)) as Record<string, any>;

    // Check required keys exist
    expect(typeof state.bundlePath).toBe("string");
    expect(path.isAbsolute(state.bundlePath)).toBe(true);
    expect(state.bundlePath).toContain(".nextellar");

    expect(typeof state.bundleSizeBytes).toBe("number");
    expect(state.bundleSizeBytes).toBeGreaterThan(0);

    expect(state.hasContracts).toBe(true);

    expect(typeof state.createdAt).toBe("string");
    // createdAt is a recent ISO timestamp
    const createdAtMs = new Date(state.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(beforeDeploy);
    expect(createdAtMs).toBeLessThanOrEqual(Date.now());

    // execa was called exactly once with tar
    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(mockExeca).toHaveBeenCalledWith(
      "tar",
      expect.arrayContaining(["-czf", "--exclude=node_modules"]),
      expect.objectContaining({ cwd: tempDir })
    );
  });

  it("sets hasContracts to false when no contracts directory exists", async () => {
    // Set up a valid project without contracts/
    await fs.writeJson(path.join(tempDir, "package.json"), {
      name: "no-contracts-app",
      dependencies: { next: "^14.0.0" },
    });
    await fs.ensureDir(path.join(tempDir, ".next"));

    mockExeca.mockImplementation(
      async (command: string, args: readonly string[]) => {
        if (command === "tar") {
          const bundlePath = args[1];
          await fs.ensureDir(path.dirname(bundlePath));
          await fs.writeFile(bundlePath, "mock-tar-bundle");
          return { stdout: "", stderr: "" } as any;
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    );

    await runDeploy({ cwd: tempDir });

    const statePath = path.join(
      tempDir,
      ".nextellar",
      "deploy",
      "latest-bundle.json"
    );
    const state = (await fs.readJson(statePath)) as Record<string, any>;
    expect(state.hasContracts).toBe(false);
  });
});
