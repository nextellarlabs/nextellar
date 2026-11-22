import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

// Same ESM mocking setup as tests/scaffold.test.ts: install, execa and the
// preflight gate are stubbed so only scaffold's workspace behaviour is real.
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

jest.setTimeout(30000);

describe("scaffold --workspace (#1117)", () => {
  let origCwd: string;
  const tmpDirs: string[] = [];

  const makeWorkspace = async (files: Record<string, string | object>) => {
    // realpath: process.cwd() reports resolved paths (e.g. /private/var on macOS).
    const dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-mono-")),
    );
    tmpDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(dir, name);
      await fs.ensureDir(path.dirname(file));
      if (typeof content === "string") await fs.writeFile(file, content);
      else await fs.writeJson(file, content);
    }
    return dir;
  };

  beforeEach(() => {
    origCwd = process.cwd();
    mockRunInstall.mockReset();
    mockRunInstall.mockImplementation(async (options: any) =>
      options.skipInstall
        ? { success: true, packageManager: "skipped" }
        : { success: true, packageManager: options.packageManager ?? "npm" },
    );
    mockExeca.mockReset();
    mockExeca.mockResolvedValue(undefined);
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    jest.restoreAllMocks();
    await Promise.all(tmpDirs.map((d) => fs.remove(d)));
    tmpDirs.length = 0;
  });

  test("npm workspace: scaffolds under apps/, drops the nested lockfile, installs from the root, skips git init", async () => {
    const root = await makeWorkspace({
      "package.json": {
        name: "mono",
        private: true,
        workspaces: ["apps/*", "packages/*"],
      },
      "package-lock.json": "{}",
    });
    process.chdir(root);

    const result = await scaffold({
      appName: "web",
      useTs: true,
      template: "minimal",
      workspace: true,
    });

    const appDir = path.join(root, "apps", "web");
    expect(result.targetDir).toBe(appDir);
    expect(result.packageManager).toBe("npm");
    expect(result.workspace).toMatchObject({
      root,
      relativeDir: "apps/web",
      registered: false,
    });
    expect((await fs.readJson(path.join(appDir, "package.json"))).name).toBe(
      "web",
    );
    expect(await fs.pathExists(path.join(appDir, "package-lock.json"))).toBe(
      false,
    );
    expect(mockRunInstall).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: root, packageManager: "npm" }),
    );
    expect(mockExeca).not.toHaveBeenCalledWith(
      "git",
      ["init"],
      expect.anything(),
    );
    // Root config already covered apps/* and must not be rewritten.
    expect(
      (await fs.readJson(path.join(root, "package.json"))).workspaces,
    ).toEqual(["apps/*", "packages/*"]);
  });

  test("pnpm workspace with an explicit root and nested path registers the app in pnpm-workspace.yaml", async () => {
    const root = await makeWorkspace({
      "package.json": { private: true },
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "pnpm-lock.yaml": "",
      "turbo.json": "{}",
    });
    const elsewhere = await makeWorkspace({});
    process.chdir(elsewhere);

    const result = await scaffold({
      appName: "services/dapp",
      useTs: true,
      template: "minimal",
      workspace: root,
      skipInstall: true,
    });

    expect(result.targetDir).toBe(path.join(root, "services", "dapp"));
    expect(result.workspace).toMatchObject({
      packageManager: "pnpm",
      turbo: true,
      registered: true,
    });
    const yaml = await fs.readFile(
      path.join(root, "pnpm-workspace.yaml"),
      "utf8",
    );
    expect(yaml).toContain('- "services/dapp"');
    expect(
      (await fs.readJson(path.join(result.targetDir, "package.json"))).name,
    ).toBe("dapp");
  });

  test("yarn workspace found by walking up from a nested directory", async () => {
    const root = await makeWorkspace({
      "package.json": {
        private: true,
        workspaces: { packages: ["packages/*"] },
      },
      "yarn.lock": "",
      "packages/existing/package.json": { name: "existing" },
    });
    process.chdir(path.join(root, "packages", "existing"));

    const result = await scaffold({
      appName: "dapp",
      useTs: true,
      template: "minimal",
      workspace: true,
    });

    expect(result.targetDir).toBe(path.join(root, "packages", "dapp"));
    expect(mockRunInstall).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: root, packageManager: "yarn" }),
    );
  });

  test("fails before writing anything when no workspace is found", async () => {
    const plain = await makeWorkspace({
      "package.json": { name: "not-a-workspace" },
    });
    await expect(
      scaffold({
        appName: "web",
        useTs: true,
        template: "minimal",
        workspace: plain,
        skipInstall: true,
      }),
    ).rejects.toThrow(/No workspace found/);
    expect(await fs.pathExists(path.join(plain, "apps"))).toBe(false);
  });

  test("rejects a --package-manager that conflicts with the workspace", async () => {
    const root = await makeWorkspace({
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    });
    await expect(
      scaffold({
        appName: "web",
        useTs: true,
        template: "minimal",
        workspace: root,
        packageManager: "npm",
        skipInstall: true,
      }),
    ).rejects.toThrow(/uses pnpm/);
    expect(await fs.pathExists(path.join(root, "apps", "web"))).toBe(false);
  });

  test("rejects an app path that escapes the workspace root", async () => {
    const root = await makeWorkspace({
      "package.json": { workspaces: ["apps/*"] },
    });
    await expect(
      scaffold({
        appName: "../evil",
        useTs: true,
        template: "minimal",
        workspace: root,
        skipInstall: true,
      }),
    ).rejects.toThrow(/outside the workspace root/);
  });

  test("dry run reports the workspace plan without writing or registering", async () => {
    const root = await makeWorkspace({
      "package.json": { workspaces: ["packages/*"] },
    });
    const result = await scaffold({
      appName: "apps/web",
      useTs: true,
      template: "minimal",
      workspace: root,
      dryRun: true,
    });

    expect(result.workspace).toMatchObject({
      relativeDir: "apps/web",
      registered: true,
    });
    expect(await fs.pathExists(path.join(root, "apps"))).toBe(false);
    expect(
      (await fs.readJson(path.join(root, "package.json"))).workspaces,
    ).toEqual(["packages/*"]);
  });

  test("install failure points the user at the workspace root and keeps the files", async () => {
    const root = await makeWorkspace({
      "package.json": { workspaces: ["apps/*"] },
      "package-lock.json": "{}",
    });
    mockRunInstall.mockResolvedValueOnce({
      success: false,
      packageManager: "npm",
    } as never);

    await expect(
      scaffold({
        appName: "web",
        useTs: true,
        template: "minimal",
        workspace: root,
      }),
    ).rejects.toThrow(
      new RegExp(`cd ${root.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`),
    );
    expect(
      await fs.pathExists(path.join(root, "apps", "web", "package.json")),
    ).toBe(true);
  });

  test("without --workspace, behaviour is unchanged (target is cwd/appName, git init runs)", async () => {
    const parent = await makeWorkspace({
      "package.json": { workspaces: ["apps/*"] },
    });
    process.chdir(parent);

    const result = await scaffold({
      appName: "standalone",
      useTs: true,
      template: "minimal",
      skipInstall: true,
    });

    expect(result.targetDir).toBe(path.join(parent, "standalone"));
    expect(result.workspace).toBeUndefined();
    expect(mockExeca).toHaveBeenCalledWith("git", ["init"], expect.anything());
  });
});
