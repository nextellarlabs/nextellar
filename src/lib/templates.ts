/**
 * Single source of truth for the starters `--template` can select.
 *
 * The CLI flag help, the CLI validation, the "unknown template" error and
 * the scaffolder all read from here so the list cannot drift between them.
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

export interface TemplateDefinition {
  /** The value passed to `--template`. */
  name: string;
  /** One-line summary used in `--help` and in the docs table. */
  description: string;
  /**
   * Directory under src/templates used for a TypeScript scaffold.
   */
  tsDir: string;
  /**
   * Directory under src/templates used for a JavaScript scaffold, or null
   * when this starter has no JavaScript variant yet.
   */
  jsDir: string | null;
}

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    name: "default",
    description:
      "full starter: wallet provider, network switcher, balances and transaction history",
    tsDir: "default",
    jsDir: "js-template",
  },
  {
    name: "minimal",
    description: "bare starter: wallet connection only, no extra UI",
    tsDir: "minimal",
    jsDir: "js-minimal",
  },
  {
    name: "defi",
    description: "DeFi starter: swap, liquidity pool and price-feed components",
    tsDir: "defi",
    jsDir: "js-defi",
  },
] as const;

/** Every valid `--template` value, in the order shown to users. */
export const TEMPLATE_NAMES: readonly string[] = TEMPLATES.map((t) => t.name);

/** Comma-separated template names, for help text and error messages. */
export const TEMPLATE_LIST = TEMPLATE_NAMES.join(", ");

/** Template names that can be scaffolded with --javascript. */
export const JS_TEMPLATE_NAMES: readonly string[] = TEMPLATES.filter(
  (t) => t.jsDir !== null,
).map((t) => t.name);

/** Comma-separated JavaScript-capable template names. */
export const JS_TEMPLATE_LIST = JS_TEMPLATE_NAMES.join(", ");

export function getTemplate(name: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function isValidTemplate(name: string): boolean {
  return getTemplate(name) !== undefined;
}

/**
 * Maps a `--template` value plus the language choice onto the directory
 * under src/templates that should be copied.
 *
 * Throws when the name is unknown, or when a known starter has no
 * JavaScript variant, so both failures carry the list of valid options.
 */
export function resolveTemplateDir(name: string, useTs: boolean): string {
  const template = getTemplate(name);
  if (!template) {
    throw new Error(
      `Unknown template "${name}". Available templates: ${TEMPLATE_LIST}.`,
    );
  }

  if (useTs) {
    return template.tsDir;
  }

  if (!template.jsDir) {
    throw new Error(
      `Template "${name}" is not available for JavaScript yet. ` +
        `Templates with a JavaScript variant: ${JS_TEMPLATE_LIST}.`,
    );
  }

  return template.jsDir;
}

/**
 * Locates the `src/templates` directory that ships with this install,
 * regardless of whether the CLI is running from source (src/bin), a built
 * package (dist/bin), or a nested workspace layout. Mirrors the resolution
 * scaffold.ts and upgrade.ts each do locally for a single template
 * directory, generalized here as the one place new commands (e.g. `nextellar
 * templates`) that need the whole templates root should resolve it from.
 */
export function findTemplatesRoot(fromDir: string): string {
  const candidates = [
    path.resolve(fromDir, "../templates"),
    path.resolve(fromDir, "../../templates"),
    path.resolve(fromDir, "../../../src/templates"),
    path.resolve(fromDir, "../../nextellar/src/templates"),
    path.resolve(fromDir, "../../../nextellar/src/templates"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ??
    candidates[candidates.length - 1]
  );
}

/** Convenience wrapper around findTemplatesRoot() using this module's own location. */
export function defaultTemplatesRoot(): string {
  return findTemplatesRoot(path.dirname(fileURLToPath(import.meta.url)));
}
