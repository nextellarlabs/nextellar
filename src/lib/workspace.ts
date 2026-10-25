import path from "path";
import fs from "fs-extra";
import type { PackageManager } from "./install.js";

/**
 * Monorepo / workspace support for `nextellar <name> --workspace` (#1117).
 *
 * Detects an existing npm, yarn, pnpm or bun workspace root (optionally a
 * Turborepo), works out where inside it a new app should live, and makes sure
 * the workspace config actually covers that location so the root install
 * links the new package.
 *
 * Deliberately dependency-free: `pnpm-workspace.yaml` is read and updated
 * with a small line-based parser that understands the `packages:` list (the
 * only key that matters here) rather than pulling in a YAML library.
 */

export type WorkspaceConfigSource = "package.json" | "pnpm-workspace.yaml";

export interface WorkspaceInfo {
  /** Absolute path of the workspace root. */
  root: string;
  /** Package manager the workspace uses; installs must run with this one. */
  packageManager: PackageManager;
  /** Where the workspace package globs are declared. */
  configSource: WorkspaceConfigSource;
  /** Workspace package globs, as declared (e.g. `["apps/*", "packages/*"]`). */
  patterns: string[];
  /** True when a `turbo.json` sits at the root (Turborepo). */
  turbo: boolean;
}

export interface WorkspaceTarget {
  /** Absolute directory the app is scaffolded into. */
  targetDir: string;
  /** POSIX-style path of the app relative to the workspace root (e.g. `apps/web`). */
  relativeDir: string;
  /** The app's package name: the last segment of `relativeDir`. */
  packageName: string;
}

const PACKAGE_MANAGERS: readonly PackageManager[] = [
  "npm",
  "yarn",
  "pnpm",
  "bun",
];

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/** Lockfile names a nested workspace package must not ship with. */
export const NESTED_LOCKFILES = LOCKFILES.map(([name]) => name);

const toPosix = (value: string) => value.replace(/\\/g, "/");

const normalizePattern = (pattern: string) =>
  toPosix(pattern.trim()).replace(/^\.\//, "").replace(/\/+$/, "");

/** Reads the `packages:` list from a pnpm-workspace.yaml document. */
export function parsePnpmWorkspacePackages(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const patterns: string[] = [];
  let inPackages = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    // Flow-style list on one line: packages: ['apps/*', 'packages/*']
    const flow = line.match(/^packages\s*:\s*\[(.*)\]\s*$/);
    if (flow) {
      return flow[1]
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    if (!inPackages) continue;
    if (line.trim() === "") continue;
    const item = line.match(/^\s+-\s*(.+?)\s*$/);
    if (item) {
      patterns.push(item[1].replace(/^['"]|['"]$/g, ""));
      continue;
    }
    // Any other top-level key ends the packages block.
    inPackages = false;
  }

  return patterns;
}

/** Returns `content` with `pattern` appended to its `packages:` list. */
export function addPnpmWorkspacePackage(
  content: string,
  pattern: string,
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const entry = `  - "${pattern}"`;
  const start = lines.findIndex((line) => /^packages\s*:/.test(line));

  if (start === -1) {
    const trimmed = content.replace(/\s+$/, "");
    return `${trimmed ? trimmed + eol : ""}packages:${eol}${entry}${eol}`;
  }

  if (/^packages\s*:\s*\[/.test(lines[start])) {
    const existing = parsePnpmWorkspacePackages(lines[start]);
    lines.splice(
      start,
      1,
      "packages:",
      ...[...existing, pattern].map((p) => `  - "${p}"`),
    );
    return lines.join(eol);
  }

  let insertAt = start + 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s+-\s*/.test(lines[i])) {
      insertAt = i + 1;
      continue;
    }
    if (lines[i].trim() === "") continue;
    break;
  }
  lines.splice(insertAt, 0, entry);
  return lines.join(eol);
}

/** Workspace globs from a root package.json (`workspaces` array or `{ packages }`). */
function packageJsonWorkspaces(pkg: Record<string, unknown>): string[] | null {
  const ws = pkg.workspaces as unknown;
  if (Array.isArray(ws)) return ws.filter((p) => typeof p === "string");
  if (ws && typeof ws === "object") {
    const packages = (ws as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((p) => typeof p === "string");
    }
  }
  return null;
}

function packageManagerFromField(value: unknown): PackageManager | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.split("@")[0]?.trim() as PackageManager;
  return PACKAGE_MANAGERS.includes(name) ? name : undefined;
}

/**
 * Inspects `dir` and returns its workspace description, or `null` when `dir`
 * is not a workspace root (no `workspaces` in package.json and no
 * pnpm-workspace.yaml).
 */
export function detectWorkspace(dir: string): WorkspaceInfo | null {
  const root = path.resolve(dir);
  const pkgPath = path.join(root, "package.json");
  const pnpmPath = path.join(root, "pnpm-workspace.yaml");

  let pkg: Record<string, unknown> = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = fs.readJsonSync(pkgPath);
    } catch {
      throw new Error(`Could not parse ${pkgPath} as JSON.`);
    }
  }

  let configSource: WorkspaceConfigSource;
  let patterns: string[];
  if (fs.existsSync(pnpmPath)) {
    configSource = "pnpm-workspace.yaml";
    patterns = parsePnpmWorkspacePackages(fs.readFileSync(pnpmPath, "utf8"));
  } else {
    const fromPkg = packageJsonWorkspaces(pkg);
    if (!fromPkg) return null;
    configSource = "package.json";
    patterns = fromPkg;
  }

  const lockfile = LOCKFILES.find(([name]) =>
    fs.existsSync(path.join(root, name)),
  );
  const packageManager: PackageManager =
    packageManagerFromField(pkg.packageManager) ??
    lockfile?.[1] ??
    (configSource === "pnpm-workspace.yaml" ? "pnpm" : "npm");

  return {
    root,
    packageManager,
    configSource,
    patterns,
    turbo: fs.existsSync(path.join(root, "turbo.json")),
  };
}

/** Walks up from `startDir` and returns the nearest workspace root, if any. */
export function findWorkspaceRoot(startDir: string): WorkspaceInfo | null {
  let current = path.resolve(startDir);
  for (;;) {
    const info = detectWorkspace(current);
    if (info) return info;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // `**` matches any number of path segments (including none after `/`).
      source += ".*";
      i++;
    } else if (ch === "*") {
      source += "[^/]*";
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when `relativeDir` is matched by the workspace globs (honouring `!` negations). */
export function isCoveredByWorkspace(
  patterns: string[],
  relativeDir: string,
): boolean {
  const target = normalizePattern(relativeDir);
  let covered = false;
  for (const raw of patterns) {
    const negated = raw.trim().startsWith("!");
    const pattern = normalizePattern(negated ? raw.trim().slice(1) : raw);
    if (!pattern) continue;
    if (globToRegExp(pattern).test(target)) {
      covered = !negated;
    }
  }
  return covered;
}

/**
 * The folder new apps go into when the user passes a bare name: `apps/`
 * when the workspace declares `apps/*`, else `packages/`, else the first
 * single-level glob's folder, else `apps/`.
 */
export function defaultAppsDir(patterns: string[]): string {
  const bases = patterns
    .filter((p) => !p.trim().startsWith("!"))
    .map(normalizePattern)
    .filter((p) => /^[^*?]+\/\*{1,2}$/.test(p))
    .map((p) => p.replace(/\/\*{1,2}$/, ""));
  if (bases.includes("apps")) return "apps";
  if (bases.includes("packages")) return "packages";
  return bases[0] ?? "apps";
}

/**
 * Resolves where `appName` lives inside the workspace. A bare name
 * (`web`) goes under {@link defaultAppsDir}; a path (`apps/web`,
 * `services/dapp`) is taken relative to the workspace root.
 *
 * @throws if the path is absolute or escapes the workspace root.
 */
export function resolveWorkspaceTarget(
  info: WorkspaceInfo,
  appName: string,
): WorkspaceTarget {
  const cleaned = normalizePattern(appName);
  if (!cleaned) {
    throw new Error("A project name is required in workspace mode.");
  }
  if (path.isAbsolute(appName) || /^[a-zA-Z]:/.test(cleaned)) {
    throw new Error(
      `In workspace mode the project name must be a name or a path relative to the workspace root, got "${appName}".`,
    );
  }

  const relativeDir = cleaned.includes("/")
    ? cleaned
    : `${defaultAppsDir(info.patterns)}/${cleaned}`;
  const targetDir = path.resolve(info.root, relativeDir);
  const fromRoot = path.relative(info.root, targetDir);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(
      `"${appName}" resolves outside the workspace root (${info.root}).`,
    );
  }

  return {
    targetDir,
    relativeDir: toPosix(fromRoot),
    packageName: path.basename(targetDir),
  };
}

/**
 * Adds `relativeDir` to the workspace config when no existing glob covers
 * it. Returns true when the config file was changed.
 */
export async function ensureWorkspaceIncludes(
  info: WorkspaceInfo,
  relativeDir: string,
): Promise<boolean> {
  if (isCoveredByWorkspace(info.patterns, relativeDir)) return false;

  if (info.configSource === "pnpm-workspace.yaml") {
    const file = path.join(info.root, "pnpm-workspace.yaml");
    const content = await fs.readFile(file, "utf8");
    await fs.writeFile(file, addPnpmWorkspacePackage(content, relativeDir));
  } else {
    const file = path.join(info.root, "package.json");
    const pkg = await fs.readJson(file);
    if (Array.isArray(pkg.workspaces)) {
      pkg.workspaces.push(relativeDir);
    } else {
      pkg.workspaces.packages = [
        ...(pkg.workspaces.packages ?? []),
        relativeDir,
      ];
    }
    await fs.writeJson(file, pkg, { spaces: 2 });
  }

  info.patterns = [...info.patterns, relativeDir];
  return true;
}

/** Removes lockfiles the template shipped, so only the root lockfile exists. */
export async function removeNestedLockfiles(targetDir: string): Promise<void> {
  for (const name of NESTED_LOCKFILES) {
    await fs.remove(path.join(targetDir, name));
  }
}

/**
 * Validates an explicit `--package-manager` against the workspace's own
 * package manager. A workspace has exactly one, so a mismatch is an error
 * rather than something to silently override.
 */
export function assertPackageManagerMatches(
  info: WorkspaceInfo,
  requested?: string,
): void {
  if (requested && requested !== info.packageManager) {
    throw new Error(
      `The workspace at ${info.root} uses ${info.packageManager}, but --package-manager ${requested} was passed. ` +
        `Drop --package-manager (the workspace's package manager is used automatically) or pass --package-manager ${info.packageManager}.`,
    );
  }
}
