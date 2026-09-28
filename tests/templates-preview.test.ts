import { jest } from "@jest/globals";
import os from "os";
import path from "path";
import fs from "fs-extra";
import {
  buildTemplatePreview,
  buildAllTemplatePreviews,
  formatPreview,
  runTemplatePreview,
} from "../src/lib/preview.js";
import { TEMPLATES, getTemplate } from "../src/lib/templates.js";

describe("template preview", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    // A small synthetic templates root so the file tree assertions don't
    // depend on the real templates' contents drifting over time.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-preview-"));
    await fs.outputFile(path.join(tmpRoot, "default", "package.json"), "{}");
    await fs.outputFile(
      path.join(tmpRoot, "default", "src", "app", "page.tsx"),
      "// page",
    );
    await fs.outputFile(
      path.join(tmpRoot, "default", "src", "components", "Button.tsx"),
      "// btn",
    );
    await fs.outputFile(
      path.join(tmpRoot, "default", "README.md"),
      "# default",
    );
    await fs.ensureDir(
      path.join(tmpRoot, "default", "node_modules", "ignored-pkg"),
    );
    await fs.outputFile(
      path.join(tmpRoot, "default", ".env.local"),
      "SECRET=1",
    );
  });

  afterEach(async () => {
    await fs.remove(tmpRoot);
  });

  it("builds a preview with description and file tree for a known template", async () => {
    const template = getTemplate("default")!;
    const preview = await buildTemplatePreview(template, "typescript", tmpRoot);

    expect(preview).not.toBeNull();
    expect(preview!.name).toBe("default");
    expect(preview!.description).toBe(template.description);
    expect(preview!.tree.join("\n")).toContain("app/");
    expect(preview!.tree.join("\n")).toContain("page.tsx");
    expect(preview!.tree.join("\n")).toContain("Button.tsx");
    expect(preview!.tree.join("\n")).toContain("README.md");
  });

  it("excludes node_modules and dotfiles from the file tree", async () => {
    const template = getTemplate("default")!;
    const preview = await buildTemplatePreview(template, "typescript", tmpRoot);

    const treeText = preview!.tree.join("\n");
    expect(treeText).not.toContain("node_modules");
    expect(treeText).not.toContain("ignored-pkg");
    expect(treeText).not.toContain(".env.local");
  });

  it("returns null for a language variant the template does not have", async () => {
    // js-defi isn't in our synthetic root, so requesting the JS variant of a
    // template whose jsDir points elsewhere resolves to an empty/no-op tree
    // rather than throwing.
    const template = getTemplate("minimal")!;
    const preview = await buildTemplatePreview(
      { ...template, jsDir: null },
      "javascript",
      tmpRoot,
    );
    expect(preview).toBeNull();
  });

  it("reports a missing template directory instead of throwing", async () => {
    const template = getTemplate("defi")!; // not present under tmpRoot
    const preview = await buildTemplatePreview(template, "typescript", tmpRoot);

    expect(preview).not.toBeNull();
    expect(preview!.tree).toEqual([]);
    expect(formatPreview(preview!)).toContain("template directory not found");
  });

  it("builds one preview per template/language combination that exists", async () => {
    const previews = await buildAllTemplatePreviews(tmpRoot);
    // Only "default" has a directory in our synthetic root, and only its
    // TypeScript variant (tsDir: "default") resolves to real files.
    const names = previews.map((p) => `${p.name}:${p.language}`);
    expect(names).toContain("default:typescript");
    // Still includes entries for templates with no directory present (empty tree).
    expect(previews.length).toBeGreaterThanOrEqual(TEMPLATES.length);
  });

  it("formats a preview as readable text with name, description and tree", async () => {
    const template = getTemplate("default")!;
    const preview = await buildTemplatePreview(template, "typescript", tmpRoot);
    const text = formatPreview(preview!);

    expect(text).toContain("default (typescript)");
    expect(text).toContain(template.description);
    expect(text).toContain("page.tsx");
  });
});

describe("runTemplatePreview (nextellar templates)", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints a preview for every template by default and exits 0", async () => {
    const code = await runTemplatePreview({});
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(code).toBe(0);
    for (const t of TEMPLATES) {
      expect(out).toContain(t.name);
      expect(out).toContain(t.description);
    }
  });

  it("scopes to a single template when --template is passed", async () => {
    const code = await runTemplatePreview({ template: "minimal" });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(code).toBe(0);
    expect(out).toContain("minimal");
    expect(out).not.toContain(getTemplate("defi")!.description);
  });

  it("errors on an unknown --template name and exits 1", async () => {
    const code = await runTemplatePreview({ template: "does-not-exist" });

    expect(code).toBe(1);
    expect(errorSpy.mock.calls.join(" ")).toMatch(
      /Unknown template "does-not-exist"/,
    );
  });

  it("emits valid JSON when --json is passed", async () => {
    const code = await runTemplatePreview({ template: "minimal", json: true });
    expect(code).toBe(0);

    const raw = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((p: { name: string }) => p.name === "minimal")).toBe(
      true,
    );
  });
});
