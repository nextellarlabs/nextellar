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
  /**
   * Optional overlay directory under src/templates copied on top of `tsDir`
   * for a TypeScript scaffold. Lets a composed starter (e.g. `full`) reuse an
   * existing starter instead of duplicating every file.
   */
  tsOverlayDir?: string;
  /** Same as `tsOverlayDir`, for a JavaScript scaffold. */
  jsOverlayDir?: string;
  /**
   * When true the `contracts-template` overlay is always applied, as if
   * `--with-contracts` had been passed.
   */
  withContracts?: boolean;
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
  {
    name: "full",
    description:
      "everything: the default component set plus defi's Soroban demo, with --with-contracts pre-enabled",
    // Composed starter (#1112): `default` is the base, the `full` / `js-full`
    // overlays add defi's CounterDemo and wire it into the landing page, and
    // the contracts overlay is always applied.
    tsDir: "default",
    jsDir: "js-template",
    tsOverlayDir: "full",
    jsOverlayDir: "js-full",
    withContracts: true,
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
 * Returns the overlay directory (under src/templates) to copy on top of the
 * resolved base starter, or null when the template has none. Call after
 * resolveTemplateDir(), which already validates the name and language.
 */
export function resolveTemplateOverlayDir(
  name: string,
  useTs: boolean,
): string | null {
  const template = getTemplate(name);
  if (!template) return null;
  return (useTs ? template.tsOverlayDir : template.jsOverlayDir) ?? null;
}

/**
 * True when the template definition sets `withContracts`, i.e. the contracts
 * overlay is part of the starter itself and is applied even when the caller
 * did not pass `--with-contracts`. (The CLI additionally turns contracts on
 * for `defi`; that stays a CLI default rather than a scaffold() rule.)
 */
export function templateForcesContracts(name: string): boolean {
  return getTemplate(name)?.withContracts === true;
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
