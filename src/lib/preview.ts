import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import {
  TEMPLATES,
  defaultTemplatesRoot,
  type TemplateDefinition,
} from "./templates.js";

/**
 * Directories/files never worth showing in a preview: build output, deps,
 * and dotfiles a user wouldn't need to see before picking a template.
 */
const IGNORED_ENTRIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "coverage",
]);

export interface TemplatePreview {
  name: string;
  description: string;
  language: "typescript" | "javascript";
  dir: string;
  /** File tree lines, already indented and ready to print. */
  tree: string[];
}

/**
 * Walks a template directory and renders an indented file tree, skipping
 * build/dependency noise (see IGNORED_ENTRIES). Depth is capped so a preview
 * stays a quick scan rather than a full recursive dump.
 */
async function renderTree(
  dir: string,
  prefix = "",
  depth = 0,
  maxDepth = 4,
): Promise<string[]> {
  if (depth > maxDepth) return [];
  if (!(await fs.pathExists(dir))) return [];

  const entries = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => !IGNORED_ENTRIES.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      // Directories first, then alphabetical — matches how most file trees read.
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    if (entry.isDirectory()) {
      lines.push(`${prefix}${connector}${pc.cyan(entry.name)}/`);
      lines.push(
        ...(await renderTree(
          path.join(dir, entry.name),
          childPrefix,
          depth + 1,
          maxDepth,
        )),
      );
    } else {
      lines.push(`${prefix}${connector}${entry.name}`);
    }
  }
  return lines;
}

/**
 * Builds a preview (description + file tree) for one template/language
 * variant without scaffolding anything. Returns null when the template has
 * no directory for the requested language (e.g. a template without a
 * JavaScript variant), so callers can skip it rather than showing an empty
 * tree.
 */
export async function buildTemplatePreview(
  template: TemplateDefinition,
  language: "typescript" | "javascript",
  templatesRoot: string = defaultTemplatesRoot(),
): Promise<TemplatePreview | null> {
  const subDir = language === "typescript" ? template.tsDir : template.jsDir;
  if (!subDir) return null;

  const dir = path.join(templatesRoot, subDir);
  const tree = await renderTree(dir);

  return {
    name: template.name,
    description: template.description,
    language,
    dir,
    tree,
  };
}

/** Builds previews for every template, in both languages where available. */
export async function buildAllTemplatePreviews(
  templatesRoot: string = defaultTemplatesRoot(),
): Promise<TemplatePreview[]> {
  const previews: TemplatePreview[] = [];
  for (const template of TEMPLATES) {
    const ts = await buildTemplatePreview(
      template,
      "typescript",
      templatesRoot,
    );
    if (ts) previews.push(ts);
    const js = await buildTemplatePreview(
      template,
      "javascript",
      templatesRoot,
    );
    if (js) previews.push(js);
  }
  return previews;
}

/** Renders one preview as printable text (used by both --json and TTY output). */
export function formatPreview(preview: TemplatePreview): string {
  const lines: string[] = [];
  const label = `${preview.name} (${preview.language})`;
  lines.push(pc.bold(pc.magenta(label)));
  lines.push(pc.dim(preview.description));
  lines.push("");
  if (preview.tree.length === 0) {
    lines.push(pc.dim("  (template directory not found)"));
  } else {
    lines.push(...preview.tree);
  }
  return lines.join("\n");
}

export interface RunTemplatePreviewOptions {
  /** Preview a single named template instead of every template. */
  template?: string;
  /** Print machine-readable JSON instead of the formatted tree. */
  json?: boolean;
}

/**
 * Entry point for `nextellar templates`. Prints each template's description
 * and file tree (or just the one passed as `opts.template`) without
 * scaffolding anything. Returns a process exit code.
 */
export async function runTemplatePreview(
  opts: RunTemplatePreviewOptions = {},
): Promise<number> {
  const templatesRoot = defaultTemplatesRoot();

  let templatesToShow = TEMPLATES;
  if (opts.template) {
    const match = TEMPLATES.find((t) => t.name === opts.template);
    if (!match) {
      console.error(
        `Unknown template "${opts.template}". Available templates: ${TEMPLATES.map((t) => t.name).join(", ")}.`,
      );
      return 1;
    }
    templatesToShow = [match];
  }

  const previews: TemplatePreview[] = [];
  for (const template of templatesToShow) {
    const ts = await buildTemplatePreview(
      template,
      "typescript",
      templatesRoot,
    );
    if (ts) previews.push(ts);
    const js = await buildTemplatePreview(
      template,
      "javascript",
      templatesRoot,
    );
    if (js) previews.push(js);
  }

  if (opts.json) {
    console.log(JSON.stringify(previews, null, 2));
    return 0;
  }

  previews.forEach((preview, i) => {
    console.log(formatPreview(preview));
    if (i < previews.length - 1) console.log("");
  });

  return 0;
}

export default runTemplatePreview;
