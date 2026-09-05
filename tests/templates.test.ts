/**
 * Template registry tests (#832)
 *
 * The `--template` flag must select every shipped starter consistently, and
 * an invalid name must fail with the list of valid options. These tests lock
 * both the registry contents and the resolution rules that the CLI and the
 * scaffolder share.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

import {
  TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_LIST,
  JS_TEMPLATE_NAMES,
  JS_TEMPLATE_LIST,
  getTemplate,
  isValidTemplate,
  resolveTemplateDir,
} from "../src/lib/templates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_ROOT = path.resolve(__dirname, "../src/templates");

describe("template registry", () => {
  it("exposes every shipped starter", () => {
    expect(TEMPLATE_NAMES).toEqual(["default", "minimal", "defi"]);
  });

  it("renders a comma-separated list for help text and errors", () => {
    expect(TEMPLATE_LIST).toBe("default, minimal, defi");
  });

  it("lists only the templates that have a JavaScript variant", () => {
    expect(JS_TEMPLATE_NAMES).toEqual(["default", "defi"]);
    expect(JS_TEMPLATE_LIST).toBe("default, defi");
  });

  it("gives every template a non-empty description for --help", () => {
    for (const template of TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  describe("isValidTemplate", () => {
    it.each(TEMPLATE_NAMES)("accepts %s", (name) => {
      expect(isValidTemplate(name)).toBe(true);
    });

    it.each(["", "nope", "Default", "js-template", "contracts-template"])(
      "rejects %p",
      (name) => {
        expect(isValidTemplate(name)).toBe(false);
      },
    );
  });

  describe("getTemplate", () => {
    it("returns the definition for a known name", () => {
      expect(getTemplate("defi")).toMatchObject({
        name: "defi",
        tsDir: "defi",
        jsDir: "js-defi",
      });
    });

    it("returns undefined for an unknown name", () => {
      expect(getTemplate("nope")).toBeUndefined();
    });
  });
});

describe("resolveTemplateDir", () => {
  describe("TypeScript", () => {
    it.each([
      ["default", "default"],
      ["minimal", "minimal"],
      ["defi", "defi"],
    ])("resolves --template %s to the %s starter", (name, dir) => {
      expect(resolveTemplateDir(name, true)).toBe(dir);
    });
  });

  describe("JavaScript", () => {
    it.each([
      ["default", "js-template"],
      ["defi", "js-defi"],
    ])("resolves --template %s to the %s starter", (name, dir) => {
      expect(resolveTemplateDir(name, false)).toBe(dir);
    });

    it("rejects a template with no JavaScript variant and lists the ones that have one", () => {
      expect(() => resolveTemplateDir("minimal", false)).toThrow(
        /not available for JavaScript/i,
      );
      expect(() => resolveTemplateDir("minimal", false)).toThrow(
        /default, defi/,
      );
    });
  });

  describe("invalid names", () => {
    it.each(["nope", "", "Default", "js-defi"])(
      "rejects %p with the list of valid options",
      (name) => {
        expect(() => resolveTemplateDir(name, true)).toThrow(
          /Unknown template/i,
        );
        expect(() => resolveTemplateDir(name, true)).toThrow(
          /default, minimal, defi/,
        );
      },
    );

    it("reports an unknown name as unknown even in JavaScript mode", () => {
      expect(() => resolveTemplateDir("nope", false)).toThrow(
        /Unknown template/i,
      );
    });
  });
});

describe("registry matches what is on disk", () => {
  it.each(TEMPLATES.map((t) => [t.name, t.tsDir]))(
    "%s points at a real TypeScript starter (%s)",
    async (_name, dir) => {
      const pkg = path.join(TEMPLATES_ROOT, dir as string, "package.json");
      expect(await fs.pathExists(pkg)).toBe(true);
    },
  );

  it.each(
    TEMPLATES.filter((t) => t.jsDir).map((t) => [t.name, t.jsDir as string]),
  )("%s points at a real JavaScript starter (%s)", async (_name, dir) => {
    const pkg = path.join(TEMPLATES_ROOT, dir, "package.json");
    expect(await fs.pathExists(pkg)).toBe(true);
  });

  it("covers every standalone starter directory on disk", async () => {
    const entries = await fs.readdir(TEMPLATES_ROOT, { withFileTypes: true });

    // A standalone starter is a directory with its own package.json.
    // contracts-template has none: it is an add-on applied by
    // --with-contracts, not a --template value.
    const starterDirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const hasPkg = await fs.pathExists(
        path.join(TEMPLATES_ROOT, entry.name, "package.json"),
      );
      if (hasPkg) starterDirs.push(entry.name);
    }

    const registered = new Set<string>();
    for (const template of TEMPLATES) {
      registered.add(template.tsDir);
      if (template.jsDir) registered.add(template.jsDir);
    }

    const unreachable = starterDirs.filter((dir) => !registered.has(dir));
    expect(unreachable).toEqual([]);
  });

  it("does not expose contracts-template as a --template value", () => {
    expect(isValidTemplate("contracts-template")).toBe(false);
  });
});
