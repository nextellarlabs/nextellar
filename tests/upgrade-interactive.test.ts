/**
 * `nextellar upgrade --interactive` (#1487)
 *
 * Each test builds a throwaway project plus a throwaway template directory.
 * The template is referenced by absolute path in `.nextellar/config.json`, so
 * `findTemplateDir()` resolves it directly and tests can mutate the "upstream"
 * template between runs without touching the real templates in this repo.
 *
 * Prompts are injected as plain callbacks, so no PTY or readline is involved.
 */
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { jest } from "@jest/globals";
import { renderInteractivePreview, upgrade } from "../src/lib/upgrade";
import {
  sha256Hex,
  UPGRADE_STATE_SCHEMA_VERSION,
  type UpgradeDecision,
  type UpgradePromptContext,
} from "../src/lib/upgrade-interactive";

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");

const STELLAR_DEPS = { "@stellar/stellar-sdk": "^14.0.0" };

type FileMap = Record<string, string | Buffer>;

/** Creates `<root>/template` with a package.json and src/hooks|lib files. */
async function makeTemplate(root: string, files: FileMap): Promise<string> {
  const dir = path.join(root, "template");
  await fs.outputJson(path.join(dir, "package.json"), {
    name: "template",
    version: "0.0.0",
    dependencies: { ...STELLAR_DEPS },
  });
  for (const [rel, content] of Object.entries(files)) {
    await fs.outputFile(path.join(dir, "src", rel), content);
  }
  return dir;
}

/** Creates `<root>/project` pointing at an absolute template directory. */
async function makeProject(
  root: string,
  templateDir: string,
  files: FileMap,
): Promise<string> {
  const projectDir = path.join(root, "project");
  await fs.outputJson(path.join(projectDir, ".nextellar", "config.json"), {
    schemaVersion: 1,
    template: templateDir,
    nextellarVersion: "1.0.0",
    createdAt: "2024-01-01T00:00:00.000Z",
  });
  await fs.outputJson(path.join(projectDir, "package.json"), {
    name: "demo",
    dependencies: { ...STELLAR_DEPS },
  });
  for (const [rel, content] of Object.entries(files)) {
    await fs.outputFile(path.join(projectDir, "src", rel), content);
  }
  return projectDir;
}

interface ScriptedPrompt {
  handler: (ctx: UpgradePromptContext) => UpgradeDecision;
  calls: UpgradePromptContext[];
}

/** Returns a handler that replays decisions in order and records each call. */
function scriptedPrompt(decisions: UpgradeDecision[]): ScriptedPrompt {
  const queue = [...decisions];
  const calls: UpgradePromptContext[] = [];
  return {
    calls,
    handler: (ctx) => {
      calls.push(ctx);
      const decision = queue.shift();
      if (decision === undefined) {
        throw new Error(`Unexpected prompt for ${ctx.file}`);
      }
      return decision;
    },
  };
}

describe("upgrade --interactive", () => {
  const originalCwd = process.cwd();
  let root: string;
  let projectDir: string;
  let logSpy: jest.SpyInstance;

  const output = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  const read = (rel: string) =>
    fs.readFile(path.join(projectDir, "src", rel), "utf8");
  const statePath = () =>
    path.join(projectDir, ".nextellar", "upgrade-state.json");

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-interactive-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    await fs.remove(root);
  });

  it("applies and skips individual files based on the prompt", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/alpha.ts": "export const alpha = 1;\n",
      "hooks/beta.ts": "export const beta = 2;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/alpha.ts": "// local alpha\n",
      "hooks/beta.ts": "// local beta\n",
    });
    process.chdir(projectDir);

    const prompt: ScriptedPrompt = {
      calls: [],
      handler: (ctx) => {
        prompt.calls.push(ctx);
        return ctx.file.endsWith("alpha.ts") ? "apply" : "skip";
      },
    };

    await upgrade({ interactive: true, prompt: prompt.handler });

    // alpha was overwritten with the template...
    expect(await read("hooks/alpha.ts")).toBe("export const alpha = 1;\n");
    // ...beta was left untouched...
    expect(await read("hooks/beta.ts")).toBe("// local beta\n");

    // ...and the skip is recorded against the incoming template hash.
    const state = await fs.readJson(statePath());
    expect(state.schemaVersion).toBe(UPGRADE_STATE_SCHEMA_VERSION);
    expect(state.updatedAt).toEqual(expect.any(String));
    expect(state.skipped).toEqual({
      "hooks/beta.ts": sha256Hex("export const beta = 2;\n"),
    });

    const out = output();
    expect(out).toContain("Applied:      1");
    expect(out).toContain("Skipped:      1");
    expect(out).toContain("Auto-skipped: 0");
    expect(out).toContain("Remaining:    0");
    expect(new Set(prompt.calls.map((c) => c.file))).toEqual(
      new Set(["hooks/alpha.ts", "hooks/beta.ts"]),
    );
  });

  it("prints a relative path, status tag and diff before each prompt", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/gamma.ts": "export const value = 2;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/gamma.ts": "export const value = 1;\n",
    });
    process.chdir(projectDir);

    let consumed = 0;
    let previewAtPrompt = "";
    const handler = () => {
      previewAtPrompt = output().slice(consumed);
      consumed = output().length;
      return "skip";
    };

    await upgrade({ interactive: true, prompt: handler });

    expect(previewAtPrompt).toContain("hooks/gamma.ts");
    expect(previewAtPrompt).toContain("[MODIFIED]");
    expect(previewAtPrompt).toContain("- export const value = 1;");
    expect(previewAtPrompt).toContain("+ export const value = 2;");
  });

  it("labels a template-only file as [NEW FILE] in the preview", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/delta.ts": "export const delta = 1;\n",
    });
    projectDir = await makeProject(root, templateDir, {});
    process.chdir(projectDir);

    let preview = "";
    const handler = () => {
      preview = output();
      return "skip";
    };

    await upgrade({ interactive: true, prompt: handler });

    expect(preview).toContain("[NEW FILE]");
    expect(preview).toContain("+ export const delta = 1;");
  });

  it("auto-skips a previously skipped file without prompting again", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/epsilon.ts": "export const epsilon = 1;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/epsilon.ts": "// local epsilon\n",
    });
    process.chdir(projectDir);

    await upgrade({ interactive: true, prompt: () => "skip" });

    logSpy.mockClear();
    let calls = 0;
    await upgrade({
      interactive: true,
      prompt: () => {
        calls++;
        return "apply";
      },
    });

    expect(calls).toBe(0);
    expect(output()).toContain(
      "Auto-skipped (unchanged since last run): hooks/epsilon.ts",
    );
    expect(output()).toContain("Auto-skipped: 1");
    // Still untouched: auto-skip must not write.
    expect(await read("hooks/epsilon.ts")).toBe("// local epsilon\n");
  });

  it("re-prompts when the template changes and clears the skip record on apply", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/zeta.ts": "export const zeta = 1;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/zeta.ts": "// local zeta\n",
    });
    process.chdir(projectDir);

    await upgrade({ interactive: true, prompt: () => "skip" });

    const firstState = await fs.readJson(statePath());
    expect(firstState.skipped["hooks/zeta.ts"]).toBe(
      sha256Hex("export const zeta = 1;\n"),
    );

    // Simulate an upstream template change.
    await fs.outputFile(
      path.join(templateDir, "src", "hooks", "zeta.ts"),
      "export const zeta = 2;\n",
    );

    logSpy.mockClear();
    const prompt = scriptedPrompt(["apply"]);
    await upgrade({ interactive: true, prompt: prompt.handler });

    expect(prompt.calls.map((c) => c.file)).toEqual(["hooks/zeta.ts"]);
    expect(await read("hooks/zeta.ts")).toBe("export const zeta = 2;\n");

    const secondState = await fs.readJson(statePath());
    expect(secondState.skipped["hooks/zeta.ts"]).toBeUndefined();
  });

  it("quit stops the loop, preserving earlier decisions and later files", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/alpha.ts": "export const alpha = 1;\n",
      "hooks/beta.ts": "export const beta = 1;\n",
      "hooks/gamma.ts": "export const gamma = 1;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/alpha.ts": "// local alpha\n",
      "hooks/beta.ts": "// local beta\n",
      "hooks/gamma.ts": "// local gamma\n",
    });
    process.chdir(projectDir);

    const prompt = scriptedPrompt(["apply", "quit", "apply"]);
    await upgrade({ interactive: true, prompt: prompt.handler });

    // alpha was applied before the quit...
    expect(await read("hooks/alpha.ts")).toBe("export const alpha = 1;\n");
    // ...beta was the file being reviewed when the user quit...
    expect(await read("hooks/beta.ts")).toBe("// local beta\n");
    // ...and gamma was never visited.
    expect(await read("hooks/gamma.ts")).toBe("// local gamma\n");

    expect(prompt.calls.map((c) => c.file)).toEqual([
      "hooks/alpha.ts",
      "hooks/beta.ts",
    ]);
    const out = output();
    expect(out).toContain("Applied:      1");
    expect(out).toContain("Remaining:    2");
    expect(out).toContain("Quit before reviewing every file.");
  });

  it("recovers gracefully from a corrupted upgrade-state.json", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/eta.ts": "export const eta = 1;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/eta.ts": "// local eta\n",
    });
    await fs.outputFile(statePath(), "{ this is not valid json");
    process.chdir(projectDir);

    const prompt = scriptedPrompt(["apply"]);
    await expect(
      upgrade({ interactive: true, prompt: prompt.handler }),
    ).resolves.toBeUndefined();

    expect(prompt.calls).toHaveLength(1);
    expect(output()).toContain(
      "Ignoring malformed .nextellar/upgrade-state.json",
    );
    expect(await read("hooks/eta.ts")).toBe("export const eta = 1;\n");
    // The corrupt file was rewritten as valid state.
    const state = await fs.readJson(statePath());
    expect(state.schemaVersion).toBe(UPGRADE_STATE_SCHEMA_VERSION);
  });

  it("rejects --interactive combined with --yes", async () => {
    const templateDir = await makeTemplate(root, {});
    projectDir = await makeProject(root, templateDir, {});
    process.chdir(projectDir);

    await expect(upgrade({ interactive: true, yes: true })).rejects.toThrow(
      /cannot be combined with --yes/,
    );
  });

  it("fails gracefully without a TTY when no prompt handler is injected", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/theta.ts": "export const theta = 1;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/theta.ts": "// local theta\n",
    });
    process.chdir(projectDir);

    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      await expect(upgrade({ interactive: true })).rejects.toThrow(
        /requires an interactive terminal/,
      );
    } finally {
      if (descriptor) {
        Object.defineProperty(process.stdin, "isTTY", descriptor);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
    }
  });

  it("ignores files whose local bytes already match the template", async () => {
    const templateDir = await makeTemplate(root, {
      "hooks/identical.ts": "export const identical = 1;\n",
      "hooks/different.ts": "export const different = 2;\n",
    });
    projectDir = await makeProject(root, templateDir, {
      "hooks/identical.ts": "export const identical = 1;\n",
      "hooks/different.ts": "// local different\n",
    });
    process.chdir(projectDir);

    const prompt = scriptedPrompt(["skip"]);
    await upgrade({ interactive: true, prompt: prompt.handler });

    expect(prompt.calls.map((c) => c.file)).toEqual(["hooks/different.ts"]);
  });
});

describe("renderInteractivePreview", () => {
  test("labels a new file and prefixes every template line with +", () => {
    const lines = renderInteractivePreview(
      path.join("hooks", "new.ts"),
      "added",
      null,
      Buffer.from("one\ntwo\n"),
    ).map(stripAnsi);

    expect(lines[0]).toContain("hooks/new.ts");
    expect(lines[0]).toContain("[NEW FILE]");
    expect(lines.slice(1)).toEqual(["+ one", "+ two", "+ "]);
  });

  test("labels a modified file and shows -/+ lines with context", () => {
    const lines = renderInteractivePreview(
      path.join("hooks", "changed.ts"),
      "updated",
      Buffer.from("same\nold\n"),
      Buffer.from("same\nnew\n"),
    ).map(stripAnsi);

    expect(lines[0]).toContain("[MODIFIED]");
    expect(lines).toContain("  same");
    expect(lines).toContain("- old");
    expect(lines).toContain("+ new");
  });

  test("summarises binary files by size instead of dumping bytes", () => {
    const template = Buffer.from([0, 1, 2, 3, 4]);
    const lines = renderInteractivePreview(
      path.join("lib", "blob.bin"),
      "updated",
      Buffer.from([0]),
      template,
    ).map(stripAnsi);

    expect(lines[0]).toContain("[MODIFIED]");
    expect(lines[1]).toContain("binary file");
    expect(lines[1]).toContain("template: 5 B");
  });

  test("caps long previews and reports the omitted line count", () => {
    const big = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
    const lines = renderInteractivePreview(
      path.join("hooks", "big.ts"),
      "updated",
      Buffer.from("old\n"),
      Buffer.from(big),
    ).map(stripAnsi);

    expect(lines.join("\n")).toContain("more line(s) not shown");
  });
});
