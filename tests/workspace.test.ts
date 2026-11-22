import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  addPnpmWorkspacePackage,
  assertPackageManagerMatches,
  defaultAppsDir,
  detectWorkspace,
  ensureWorkspaceIncludes,
  findWorkspaceRoot,
  isCoveredByWorkspace,
  parsePnpmWorkspacePackages,
  removeNestedLockfiles,
  resolveWorkspaceTarget,
  type WorkspaceInfo,
} from "../src/lib/workspace";

describe("workspace helpers (#1117)", () => {
  const tmpDirs: string[] = [];

  const makeRoot = async (files: Record<string, string | object>) => {
    // realpath: process.cwd() reports resolved paths (e.g. /private/var on macOS).
    const dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-ws-")),
    );
    tmpDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(dir, name);
      await fs.ensureDir(path.dirname(file));
      if (typeof content === "string") {
        await fs.writeFile(file, content);
      } else {
        await fs.writeJson(file, content);
      }
    }
    return dir;
  };

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d)));
    tmpDirs.length = 0;
  });

  describe("parsePnpmWorkspacePackages", () => {
    it("reads a block-style packages list, quoted or not", () => {
      const yaml =
        "packages:\n  - 'apps/*'\n  - \"packages/*\"\n  - tools/cli # comment\ncatalog:\n  react: ^18\n";
      expect(parsePnpmWorkspacePackages(yaml)).toEqual([
        "apps/*",
        "packages/*",
        "tools/cli",
      ]);
    });

    it("reads a flow-style packages list", () => {
      expect(
        parsePnpmWorkspacePackages("packages: ['apps/*', 'libs/*']\n"),
      ).toEqual(["apps/*", "libs/*"]);
    });

    it("returns an empty list when there is no packages key", () => {
      expect(parsePnpmWorkspacePackages("catalog:\n  react: ^18\n")).toEqual(
        [],
      );
    });
  });

  describe("addPnpmWorkspacePackage", () => {
    it("appends after the last list item and keeps other keys", () => {
      const out = addPnpmWorkspacePackage(
        "packages:\n  - 'apps/*'\ncatalog:\n  react: ^18\n",
        "services/dapp",
      );
      expect(parsePnpmWorkspacePackages(out)).toEqual([
        "apps/*",
        "services/dapp",
      ]);
      expect(out).toContain("catalog:\n  react: ^18");
    });

    it("creates the packages key when missing", () => {
      const out = addPnpmWorkspacePackage("", "apps/web");
      expect(parsePnpmWorkspacePackages(out)).toEqual(["apps/web"]);
    });

    it("converts a flow-style list and preserves CRLF line endings", () => {
      const out = addPnpmWorkspacePackage(
        "packages: ['apps/*']\r\nfoo: bar\r\n",
        "x/y",
      );
      expect(out).toContain("\r\n");
      expect(parsePnpmWorkspacePackages(out)).toEqual(["apps/*", "x/y"]);
    });
  });

  describe("detectWorkspace", () => {
    it("detects an npm workspace from package.json + package-lock.json", async () => {
      const root = await makeRoot({
        "package.json": { name: "mono", private: true, workspaces: ["apps/*"] },
        "package-lock.json": "{}",
      });
      expect(detectWorkspace(root)).toEqual({
        root,
        packageManager: "npm",
        configSource: "package.json",
        patterns: ["apps/*"],
        turbo: false,
      });
    });

    it("detects a yarn workspace using the { packages } object form", async () => {
      const root = await makeRoot({
        "package.json": {
          private: true,
          workspaces: { packages: ["packages/*"] },
        },
        "yarn.lock": "",
      });
      const info = detectWorkspace(root);
      expect(info?.packageManager).toBe("yarn");
      expect(info?.patterns).toEqual(["packages/*"]);
    });

    it("detects a pnpm workspace and Turborepo even without a lockfile", async () => {
      const root = await makeRoot({
        "package.json": { private: true },
        "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
        "turbo.json": "{}",
      });
      const info = detectWorkspace(root);
      expect(info?.packageManager).toBe("pnpm");
      expect(info?.configSource).toBe("pnpm-workspace.yaml");
      expect(info?.turbo).toBe(true);
    });

    it("prefers the packageManager field over lockfiles", async () => {
      const root = await makeRoot({
        "package.json": {
          workspaces: ["apps/*"],
          packageManager: "yarn@4.1.0",
        },
        "package-lock.json": "{}",
      });
      expect(detectWorkspace(root)?.packageManager).toBe("yarn");
    });

    it("returns null for a plain (non-workspace) project", async () => {
      const root = await makeRoot({ "package.json": { name: "app" } });
      expect(detectWorkspace(root)).toBeNull();
    });

    it("throws a clear error for an unparseable package.json", async () => {
      const root = await makeRoot({ "package.json": "{ not json" });
      expect(() => detectWorkspace(root)).toThrow(/Could not parse/);
    });
  });

  describe("findWorkspaceRoot", () => {
    it("walks up from a nested directory to the workspace root", async () => {
      const root = await makeRoot({
        "package.json": { workspaces: ["apps/*"] },
        "apps/existing/package.json": { name: "existing" },
      });
      expect(findWorkspaceRoot(path.join(root, "apps", "existing"))?.root).toBe(
        root,
      );
    });

    it("returns null when no ancestor is a workspace", async () => {
      const root = await makeRoot({ "package.json": { name: "app" } });
      // os.tmpdir() ancestors are not workspaces in CI/test environments.
      expect(findWorkspaceRoot(root)).toBeNull();
    });
  });

  describe("isCoveredByWorkspace / defaultAppsDir", () => {
    it("matches single-level, recursive and exact globs, honouring negations", () => {
      expect(isCoveredByWorkspace(["apps/*"], "apps/web")).toBe(true);
      expect(isCoveredByWorkspace(["apps/*"], "apps/web/nested")).toBe(false);
      expect(isCoveredByWorkspace(["./apps/**"], "apps/web/nested")).toBe(true);
      expect(isCoveredByWorkspace(["services/dapp"], "services/dapp")).toBe(
        true,
      );
      expect(
        isCoveredByWorkspace(["apps/*", "!apps/legacy"], "apps/legacy"),
      ).toBe(false);
      expect(isCoveredByWorkspace([], "apps/web")).toBe(false);
    });

    it("prefers apps/, then packages/, then the first folder glob", () => {
      expect(defaultAppsDir(["packages/*", "apps/*"])).toBe("apps");
      expect(defaultAppsDir(["packages/*"])).toBe("packages");
      expect(defaultAppsDir(["sites/*", "libs/**"])).toBe("sites");
      expect(defaultAppsDir(["tools/cli"])).toBe("apps");
    });
  });

  describe("resolveWorkspaceTarget", () => {
    const info: WorkspaceInfo = {
      root: path.resolve("/repo"),
      packageManager: "pnpm",
      configSource: "pnpm-workspace.yaml",
      patterns: ["apps/*", "packages/*"],
      turbo: false,
    };

    it("places a bare name under the default apps folder", () => {
      expect(resolveWorkspaceTarget(info, "web")).toEqual({
        targetDir: path.join(info.root, "apps", "web"),
        relativeDir: "apps/web",
        packageName: "web",
      });
    });

    it("keeps an explicit relative path and uses its last segment as the name", () => {
      const t = resolveWorkspaceTarget(info, "services\\dapp");
      expect(t.relativeDir).toBe("services/dapp");
      expect(t.packageName).toBe("dapp");
    });

    it("rejects paths that escape the root or are absolute", () => {
      expect(() => resolveWorkspaceTarget(info, "../outside")).toThrow(
        /outside the workspace root/,
      );
      expect(() =>
        resolveWorkspaceTarget(info, path.resolve("/abs/app")),
      ).toThrow(/relative to the workspace root/);
      expect(() => resolveWorkspaceTarget(info, "  ")).toThrow(
        /project name is required/,
      );
    });
  });

  describe("ensureWorkspaceIncludes", () => {
    it("leaves the config untouched when a glob already covers the app", async () => {
      const root = await makeRoot({
        "package.json": { workspaces: ["apps/*"] },
      });
      const info = detectWorkspace(root)!;
      expect(await ensureWorkspaceIncludes(info, "apps/web")).toBe(false);
      expect(
        (await fs.readJson(path.join(root, "package.json"))).workspaces,
      ).toEqual(["apps/*"]);
    });

    it("appends to package.json workspaces (array and object forms)", async () => {
      const arrRoot = await makeRoot({
        "package.json": { workspaces: ["packages/*"] },
      });
      expect(
        await ensureWorkspaceIncludes(
          detectWorkspace(arrRoot)!,
          "services/dapp",
        ),
      ).toBe(true);
      expect(
        (await fs.readJson(path.join(arrRoot, "package.json"))).workspaces,
      ).toEqual(["packages/*", "services/dapp"]);

      const objRoot = await makeRoot({
        "package.json": {
          workspaces: { packages: ["packages/*"], nohoist: ["**/x"] },
        },
      });
      await ensureWorkspaceIncludes(detectWorkspace(objRoot)!, "services/dapp");
      expect(
        (await fs.readJson(path.join(objRoot, "package.json"))).workspaces,
      ).toEqual({
        packages: ["packages/*", "services/dapp"],
        nohoist: ["**/x"],
      });
    });

    it("appends to pnpm-workspace.yaml", async () => {
      const root = await makeRoot({
        "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      });
      await ensureWorkspaceIncludes(detectWorkspace(root)!, "apps/web");
      const yaml = await fs.readFile(
        path.join(root, "pnpm-workspace.yaml"),
        "utf8",
      );
      expect(parsePnpmWorkspacePackages(yaml)).toEqual([
        "packages/*",
        "apps/web",
      ]);
    });
  });

  describe("removeNestedLockfiles / assertPackageManagerMatches", () => {
    it("removes every known lockfile from the app directory", async () => {
      const root = await makeRoot({
        "package-lock.json": "{}",
        "yarn.lock": "",
        "keep.txt": "x",
      });
      await removeNestedLockfiles(root);
      expect(await fs.pathExists(path.join(root, "package-lock.json"))).toBe(
        false,
      );
      expect(await fs.pathExists(path.join(root, "yarn.lock"))).toBe(false);
      expect(await fs.pathExists(path.join(root, "keep.txt"))).toBe(true);
    });

    it("accepts a matching or absent --package-manager and rejects a mismatch", () => {
      const info = { root: "/repo", packageManager: "pnpm" } as WorkspaceInfo;
      expect(() => assertPackageManagerMatches(info)).not.toThrow();
      expect(() => assertPackageManagerMatches(info, "pnpm")).not.toThrow();
      expect(() => assertPackageManagerMatches(info, "npm")).toThrow(
        /uses pnpm/,
      );
    });
  });
});
