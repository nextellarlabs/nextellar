import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { jest } from "@jest/globals";
import { upgrade } from "../src/lib/upgrade";

type TreeEntry =
  | { path: string; type: "directory" }
  | { hash: string; path: string; type: "file" };

async function snapshotTree(root: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];

  async function visit(directory: string): Promise<void> {
    const children = await fs.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");

      if (child.isDirectory()) {
        entries.push({ path: relativePath, type: "directory" });
        await visit(absolutePath);
        continue;
      }

      const content = await fs.readFile(absolutePath);
      entries.push({
        hash: createHash("sha256").update(content).digest("hex"),
        path: relativePath,
        type: "file",
      });
    }
  }

  await visit(root);
  return entries;
}

describe("upgrade dry run", () => {
  const originalCwd = process.cwd();
  let projectDir: string;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-upgrade-"));
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    consoleLogSpy.mockRestore();
    await fs.remove(projectDir);
  });

  test("reports changes without modifying the project tree", async () => {
    const hookPath = path.join(
      projectDir,
      "src",
      "hooks",
      "useSorobanContract.ts",
    );

    await fs.outputJson(path.join(projectDir, ".nextellar", "config.json"), {
      nextellarVersion: "1.0.0",
      template: "default",
    });
    await fs.outputFile(hookPath, "// Local project customization\n");

    const before = await snapshotTree(projectDir);
    process.chdir(projectDir);

    await upgrade({ dryRun: true });

    expect(await snapshotTree(projectDir)).toEqual(before);
    expect(consoleLogSpy.mock.calls.flat().join("\n")).toContain(
      path.join("hooks", "useSorobanContract.ts"),
    );
  });
});
