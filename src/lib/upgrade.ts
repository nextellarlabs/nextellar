import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "url";
import { recordAuditEvent } from "./audit-log.js";
import {
  PROJECT_CONFIG_SCHEMA_VERSION,
  migrateProjectConfig,
} from "./project-config.js";
import { getTemplate } from "./templates.js";
import {
  createReadlineUpgradePrompt,
  formatBytes,
  isProbablyBinary,
  loadUpgradeState,
  saveUpgradeState,
  sha256Hex,
  toPosix,
  type UpgradeDecision,
  type UpgradePromptHandler,
} from "./upgrade-interactive.js";

interface UpgradeOptions {
  dryRun?: boolean;
  yes?: boolean;
  check?: boolean;
  /**
   * Print a full, untruncated file-by-file diff between the project and the
   * latest template, then exit without prompting or writing anything (#1116).
   */
  diff?: boolean;
  /**
   * Review each drifted file individually (apply/skip/quit) instead of
   * prompting once for everything (#1487). Skip decisions are persisted in
   * `.nextellar/upgrade-state.json` keyed by the template's SHA-256.
   */
  interactive?: boolean;
  /** Injectable prompt handler; primarily for tests and custom UIs. */
  prompt?: UpgradePromptHandler;
}

/** One template file that differs from the local project (or is missing). */
interface UpgradeChange {
  file: string;
  projectFile: string;
  templateFile: string;
  status: "added" | "updated";
}

const STELLAR_PKGS = [
  "@stellar/stellar-sdk",
  "@creit.tech/stellar-wallets-kit",
];

/**
 * Renders a minimal unified line-diff between two file contents, colorized
 * via picocolors (which already honors NO_COLOR and non-TTY output on its
 * own, so no separate color-support check is needed here).
 *
 * This is a plain LCS-based line diff rather than a pulled-in dependency:
 * `diff` is only present transitively (via ts-node, a devDependency) so
 * depending on it directly would be relying on an implementation detail
 * that could disappear on a lockfile bump.
 */
function diffLines(oldContent: string, newContent: string): string[] {
  const a = oldContent.split("\n");
  const b = newContent.split("\n");

  // Standard LCS table, then backtrack to emit a unified add/remove diff.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(pc.dim(`  ${a[i]}`));
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(pc.red(`- ${a[i]}`));
      i++;
    } else {
      out.push(pc.green(`+ ${b[j]}`));
      j++;
    }
  }
  while (i < a.length) {
    out.push(pc.red(`- ${a[i]}`));
    i++;
  }
  while (j < b.length) {
    out.push(pc.green(`+ ${b[j]}`));
    j++;
  }
  return out;
}

/**
 * Renders a colorized, truncated line-diff for one changed file, capped at
 * `maxLines` so a large rewrite doesn't flood the terminal.
 */
function renderFileDiff(
  oldContent: string,
  newContent: string,
  maxLines = 20,
): string[] {
  const lines = diffLines(oldContent, newContent);
  if (lines.length <= maxLines) return lines;
  const shown = lines.slice(0, maxLines);
  const omitted = lines.length - maxLines;
  shown.push(pc.dim(`  … ${omitted} more line(s) not shown`));
  return shown;
}

/**
 * Renders a complete unified-style diff for one file, with `---`/`+++`
 * headers so the output reads like `git diff`. Unlike renderFileDiff() this
 * is never truncated: `--diff` exists to show everything before upgrading.
 * A missing project file (template-only, i.e. "added") diffs against "".
 */
export function renderFullFileDiff(
  rel: string,
  projectContent: string | null,
  templateContent: string,
): string[] {
  const relPosix = rel.split(path.sep).join("/");
  const header = [
    pc.bold(
      projectContent === null
        ? `--- /dev/null`
        : `--- a/src/${relPosix} (project)`,
    ),
    pc.bold(`+++ b/src/${relPosix} (template)`),
  ];
  if (projectContent === null) {
    return [
      ...header,
      ...templateContent.split("\n").map((line) => pc.green(`+ ${line}`)),
    ];
  }
  return [...header, ...diffLines(projectContent, templateContent)];
}

/**
 * Renders the per-file preview shown before each interactive prompt: the
 * relative path, an explicit status tag, and a capped unified diff. New files
 * diff against nothing (all `+` lines); binary files get a byte-size summary
 * instead of raw bytes so the terminal stays readable.
 */
export function renderInteractivePreview(
  rel: string,
  status: "added" | "updated",
  local: Buffer | null,
  template: Buffer,
): string[] {
  const label =
    status === "added" ? pc.green("[NEW FILE]") : pc.yellow("[MODIFIED]");
  const header = `${pc.bold(toPosix(rel))} ${label}`;

  const localIsBinary = local ? isProbablyBinary(local) : false;
  if (localIsBinary || isProbablyBinary(template)) {
    const localDesc = local ? formatBytes(local.length) : "absent";
    return [
      header,
      pc.dim(
        `  binary file (local: ${localDesc}, template: ${formatBytes(template.length)})`,
      ),
    ];
  }

  const newContent = template.toString("utf8");
  const oldContent = local ? local.toString("utf8") : null;

  let lines: string[];
  if (oldContent === null) {
    lines = newContent.split("\n").map((line) => pc.green(`+ ${line}`));
  } else {
    lines = diffLines(oldContent, newContent);
  }

  const maxLines = 40;
  if (lines.length > maxLines) {
    const shown = lines.slice(0, maxLines);
    shown.push(pc.dim(`  … ${lines.length - maxLines} more line(s) not shown`));
    lines = shown;
  }

  return [header, ...lines];
}

/** Compares dotted version strings numerically; non-numeric parts sort as 0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function findTemplateDir(templateName: string) {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  // A registered template's TypeScript starter may live in a directory with a
  // different name (e.g. `full` is composed on top of `default`, #1112), so
  // resolve through the registry first and fall back to the raw name.
  const dirName = getTemplate(templateName)?.tsDir ?? templateName;
  // src/lib/upgrade.ts, dist/src/lib/upgrade.js and a bundled dist/templates
  // all resolve the template from a different depth.
  const candidates = [
    path.resolve(base, "../templates", dirName),
    path.resolve(base, "../../templates", dirName),
    path.resolve(base, "../../../src/templates", dirName),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ??
    candidates[candidates.length - 1]
  );
}

interface InteractiveUpgradeContext {
  cwd: string;
  nextellarDir: string;
  configPath: string;
  projectConfig: Record<string, unknown>;
  templateName: string;
  currentVersion: string;
  cliVersion: string;
  changes: UpgradeChange[];
  pkgChanges: Record<string, { from?: string; to?: string }>;
  projPkgPath: string;
  prompt?: UpgradePromptHandler;
  persistMigration: () => Promise<void>;
}

/**
 * Per-file interactive apply/skip/quit loop (#1487).
 *
 * Every decision is flushed to `.nextellar/upgrade-state.json` immediately so
 * earlier `apply`/`skip` outcomes survive a later `quit` (or Ctrl+C). Files
 * already skipped against the current template hash are auto-skipped without
 * prompting.
 */
async function runInteractiveUpgrade(
  ctx: InteractiveUpgradeContext,
): Promise<void> {
  const {
    cwd,
    nextellarDir,
    configPath,
    projectConfig,
    templateName,
    currentVersion,
    cliVersion,
    changes,
    pkgChanges,
    projPkgPath,
  } = ctx;

  if (!ctx.prompt && !process.stdin.isTTY) {
    throw new Error(
      "--interactive requires an interactive terminal. Use --yes to apply all changes without prompting.",
    );
  }

  let closePrompt: (() => void) | undefined;
  let promptHandler: UpgradePromptHandler;
  if (ctx.prompt) {
    promptHandler = ctx.prompt;
  } else {
    const prompt = createReadlineUpgradePrompt();
    promptHandler = prompt.handler;
    closePrompt = prompt.close;
  }

  const { state, corrupted } = await loadUpgradeState(cwd);
  if (corrupted) {
    console.log(
      pc.yellow(
        "Ignoring malformed .nextellar/upgrade-state.json; starting fresh.",
      ),
    );
  }

  const backupDir = path.join(
    nextellarDir,
    "backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  let backupReady = false;
  const ensureBackupDir = async () => {
    if (backupReady) return;
    await fs.ensureDir(backupDir);
    backupReady = true;
  };

  let applied = 0;
  let skipped = 0;
  let autoSkipped = 0;
  let quit = false;
  const appliedFiles: string[] = [];

  try {
    for (const change of changes) {
      const relPosix = toPosix(change.file);
      const templateBuf = await fs.readFile(change.templateFile);
      const templateHash = sha256Hex(templateBuf);
      const localExists = await fs.pathExists(change.projectFile);
      const localBuf = localExists
        ? await fs.readFile(change.projectFile)
        : null;

      if (state.skipped[relPosix] === templateHash) {
        autoSkipped++;
        console.log(
          pc.dim(`Auto-skipped (unchanged since last run): ${relPosix}`),
        );
        continue;
      }

      console.log("");
      for (const line of renderInteractivePreview(
        relPosix,
        change.status,
        localBuf,
        templateBuf,
      )) {
        console.log(line);
      }

      let decision: UpgradeDecision;
      try {
        decision = await promptHandler({
          file: relPosix,
          status: change.status,
        });
      } catch {
        console.log("\nUpgrade cancelled.");
        decision = "quit";
      }

      if (decision === "apply") {
        await ensureBackupDir();
        if (localExists) {
          const relPath = path.relative(cwd, change.projectFile);
          const destBackup = path.join(backupDir, relPath);
          await fs.ensureDir(path.dirname(destBackup));
          await fs.copyFile(change.projectFile, destBackup);
        }
        await fs.ensureDir(path.dirname(change.projectFile));
        await fs.copyFile(change.templateFile, change.projectFile);
        if (state.skipped[relPosix] !== undefined) {
          delete state.skipped[relPosix];
        }
        await saveUpgradeState(cwd, state);
        applied++;
        appliedFiles.push(relPosix);
        console.log(pc.green(`Applied ${relPosix}`));
      } else if (decision === "skip") {
        state.skipped[relPosix] = templateHash;
        await saveUpgradeState(cwd, state);
        skipped++;
        console.log(pc.dim(`Skipped ${relPosix}`));
      } else {
        quit = true;
        break;
      }
    }
  } finally {
    closePrompt?.();
  }

  const pkgEntries = Object.entries(pkgChanges);
  const applyPackages = !quit && pkgEntries.length > 0;
  if (applyPackages) {
    await ensureBackupDir();
    const projPkg = await fs.readJson(projPkgPath);
    for (const [pkg, v] of pkgEntries) {
      if (v.to) {
        if (projPkg.dependencies && pkg in projPkg.dependencies)
          projPkg.dependencies[pkg] = v.to;
        else if (projPkg.devDependencies && pkg in projPkg.devDependencies)
          projPkg.devDependencies[pkg] = v.to;
        else if (!projPkg.dependencies) projPkg.dependencies = { [pkg]: v.to };
      }
    }
    await fs.copyFile(projPkgPath, path.join(backupDir, "package.json"));
    await fs.writeJson(projPkgPath, projPkg, { spaces: 2 });
    console.log(pc.green("Updated package.json dependencies"));
  }

  const changedSomething = applied > 0 || applyPackages;
  if (changedSomething) {
    projectConfig.nextellarVersion = cliVersion;
    projectConfig.updatedAt = new Date().toISOString();
    await fs.writeJson(configPath, projectConfig, { spaces: 2 });
  }
  await ctx.persistMigration();

  if (changedSomething) {
    await recordAuditEvent(cwd, "upgrade", {
      template: templateName,
      fromVersion: currentVersion,
      toVersion: cliVersion,
      filesChanged: appliedFiles,
      skippedFiles: Object.keys(state.skipped),
      packagesChanged: pkgChanges,
    });
  }

  const remaining = changes.length - (applied + skipped + autoSkipped);

  console.log("");
  console.log(pc.bold("Interactive upgrade summary:"));
  console.log(`  Applied:      ${applied}`);
  console.log(`  Skipped:      ${skipped}`);
  console.log(`  Auto-skipped: ${autoSkipped}`);
  console.log(`  Remaining:    ${remaining}`);
  if (applied > 0) {
    console.log(
      pc.dim(`Backups saved to ${path.relative(cwd, backupDir) || backupDir}`),
    );
  }
  if (quit) {
    console.log(pc.yellow("Quit before reviewing every file."));
  }
}

export async function upgrade(opts: UpgradeOptions = {}) {
  if (opts.interactive && opts.yes) {
    throw new Error("--interactive cannot be combined with --yes; choose one.");
  }
  const cwd = process.cwd();

  // Detect Nextellar project marker
  const nextellarDir = path.join(cwd, ".nextellar");
  const configPath = path.join(nextellarDir, "config.json");

  if (!(await fs.pathExists(configPath))) {
    throw new Error("Not a Nextellar project: missing .nextellar/config.json");
  }

  let rawConfig: unknown;
  try {
    rawConfig = await fs.readJson(configPath);
  } catch {
    throw new Error(
      "Invalid .nextellar/config.json: not valid JSON. Fix or recreate it (see docs/config-migration-guide.md).",
    );
  }
  // Migrate legacy config shapes (#907). Lossless and idempotent; persisted
  // below only when the upgrade actually writes (never on --dry-run/--check).
  const configStat = await fs.stat(configPath);
  const migration = migrateProjectConfig(rawConfig, {
    fallbackCreatedAt: configStat.mtime.toISOString(),
  });
  const projectConfig: Record<string, unknown> = { ...migration.config };
  const templateName = String(projectConfig.template || "default");
  const currentVersion = String(projectConfig.nextellarVersion || "unknown");
  const persistMigration = async () => {
    if (!migration.migrated) return;
    await fs.writeJson(configPath, projectConfig, { spaces: 2 });
    console.log(
      pc.green(
        `Migrated .nextellar/config.json to schema v${PROJECT_CONFIG_SCHEMA_VERSION}`,
      ),
    );
  };

  const myPkg = await fs.readJson(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json",
    ),
  );
  const cliVersion: string = myPkg.version || "0.0.0";

  console.log(pc.cyan("Nextellar Upgrade"));
  console.log(`Project template: ${pc.bold(templateName)}`);
  console.log(`${currentVersion} -> ${cliVersion}`);
  if (migration.migrated) {
    console.log(
      pc.yellow(
        `Legacy .nextellar/config.json (schema v${migration.fromVersion}) will be migrated to v${PROJECT_CONFIG_SCHEMA_VERSION}:`,
      ),
    );
    for (const change of migration.changes) console.log(` - ${change}`);
  }
  console.log("");

  if (
    currentVersion !== "unknown" &&
    compareVersions(cliVersion, currentVersion) < 0
  ) {
    console.log(
      pc.red(
        `⚠️  Installed Nextellar CLI (${cliVersion}) is older than this project (${currentVersion}).`,
      ),
    );
    console.log(
      pc.red("Upgrading would downgrade project files. Update the CLI first."),
    );
    if (!opts.yes && !opts.diff) {
      console.log(pc.yellow("Re-run with --yes to proceed anyway."));
      return;
    }
    console.log(
      pc.yellow("--yes specified; proceeding despite the downgrade."),
    );
  }

  const templateDir = findTemplateDir(templateName);
  if (!templateDir || !(await fs.pathExists(templateDir))) {
    throw new Error(`Could not locate template for '${templateName}'`);
  }

  // Files to consider updating: hooks and lib
  const templateSrc = path.join(templateDir, "src");
  const candidates: string[] = [];

  for (const sub of ["hooks", "lib"]) {
    const dir = path.join(templateSrc, sub);
    if (await fs.pathExists(dir)) {
      const files = await fs.readdir(dir);
      files.sort();
      for (const f of files) {
        const full = path.join(dir, f);
        const stat = await fs.stat(full);
        if (stat.isFile()) candidates.push(toPosix(path.join(sub, f)));
      }
    }
  }

  // Compare and collect diffs
  const changes: UpgradeChange[] = [];
  let unchangedCount = 0;
  for (const rel of candidates) {
    const templateFile = path.join(templateSrc, rel);
    const projectFile = path.join(cwd, "src", rel);
    if (!(await fs.pathExists(projectFile))) {
      changes.push({ file: rel, projectFile, templateFile, status: "added" });
      continue;
    }
    // Compare bytes (not decoded text) so any byte-level drift counts, and so
    // a file whose bytes already match the template is never prompted about.
    const [a, b] = await Promise.all([
      fs.readFile(templateFile),
      fs.readFile(projectFile),
    ]);
    if (!a.equals(b)) {
      changes.push({ file: rel, projectFile, templateFile, status: "updated" });
    } else {
      unchangedCount++;
    }
  }

  // Compare package.json dependencies for stellar packages
  const projPkgPath = path.join(cwd, "package.json");
  const tplPkgPath = path.join(templateDir, "package.json");
  const pkgChanges: Record<string, { from?: string; to?: string }> = {};
  if ((await fs.pathExists(projPkgPath)) && (await fs.pathExists(tplPkgPath))) {
    const projPkg = await fs.readJson(projPkgPath);
    const tplPkg = await fs.readJson(tplPkgPath);
    const tplDeps = {
      ...(tplPkg.dependencies || {}),
      ...(tplPkg.devDependencies || {}),
    };
    const projDeps = {
      ...(projPkg.dependencies || {}),
      ...(projPkg.devDependencies || {}),
    };
    for (const pkg of STELLAR_PKGS) {
      if (tplDeps[pkg] && projDeps[pkg] && tplDeps[pkg] !== projDeps[pkg]) {
        pkgChanges[pkg] = { from: projDeps[pkg], to: tplDeps[pkg] };
      } else if (tplDeps[pkg] && !projDeps[pkg]) {
        pkgChanges[pkg] = { from: undefined, to: tplDeps[pkg] };
      }
    }
  }

  if (changes.length === 0 && Object.keys(pkgChanges).length === 0) {
    console.log(pc.green("✔️  No template updates to apply."));
    if (!opts.dryRun && !opts.check) await persistMigration();
    return;
  }

  // --diff (#1116): read-only, file-by-file preview of every drifted file.
  // Runs before any prompt, backup or write, and wins over --yes.
  if (opts.diff) {
    console.log(pc.cyan("Template diff (project -> latest template):"));
    for (const c of changes) {
      const templateContent = await fs.readFile(c.templateFile, "utf8");
      const projectContent =
        c.status === "added" ? null : await fs.readFile(c.projectFile, "utf8");
      console.log("");
      for (const line of renderFullFileDiff(
        c.file,
        projectContent,
        templateContent,
      )) {
        console.log(line);
      }
    }
    if (Object.keys(pkgChanges).length > 0) {
      console.log("");
      console.log(pc.bold("--- a/package.json (project)"));
      console.log(pc.bold("+++ b/package.json (template)"));
      for (const [k, v] of Object.entries(pkgChanges)) {
        if (v.from) console.log(pc.red(`- "${k}": "${v.from}"`));
        console.log(pc.green(`+ "${k}": "${v.to}"`));
      }
    }
    console.log("");
    console.log(
      pc.dim(
        `${changes.length} file(s) differ, ${Object.keys(pkgChanges).length} package(s) differ, ${unchangedCount} file(s) unchanged.`,
      ),
    );
    console.log(pc.magenta("--diff specified; no files were modified."));
    return;
  }

  // --interactive (#1487): per-file apply/skip/quit instead of one global
  // confirmation. Runs before the normal summary/changelog and returns; all
  // writes and state persistence happen inside the loop.
  if (opts.interactive) {
    await runInteractiveUpgrade({
      cwd,
      nextellarDir,
      configPath,
      projectConfig,
      templateName,
      currentVersion,
      cliVersion,
      changes,
      pkgChanges,
      projPkgPath,
      prompt: opts.prompt,
      persistMigration,
    });
    return;
  }

  const added = changes.filter((c) => c.status === "added");
  const updated = changes.filter((c) => c.status === "updated");

  if (added.length > 0) {
    console.log(pc.yellow("Added:"));
    for (const c of added) console.log(` - ${c.file}`);
  }
  if (updated.length > 0) {
    console.log(pc.yellow("Updated:"));
    for (const c of updated) console.log(` - ${c.file}`);
  }
  for (const [k, v] of Object.entries(pkgChanges))
    console.log(` - package.json: ${k} ${v.from || "(new)"} → ${v.to}`);
  console.log(pc.dim(`Unchanged: ${unchangedCount} file(s)`));

  // Display changelog summary
  if (changes.length > 0) {
    console.log("");
    console.log(pc.cyan("Changelog:"));
    for (const c of changes) {
      const isNew = !(await fs.pathExists(c.projectFile));
      if (isNew) {
        console.log(` + ${pc.green(c.file)} (new file)`);
      } else {
        console.log(` ~ ${pc.yellow(c.file)} (modified)`);
        const [oldContent, newContent] = await Promise.all([
          fs.readFile(c.projectFile, "utf8"),
          fs.readFile(c.templateFile, "utf8"),
        ]);
        for (const line of renderFileDiff(oldContent, newContent)) {
          console.log(`   ${line}`);
        }
      }
    }
  }

  if (opts.check) {
    console.log("");
    console.log(
      pc.magenta(
        "--check specified; dry preview only. No files were modified.",
      ),
    );
    return;
  }

  if (opts.dryRun) {
    console.log("");
    console.log(pc.magenta("--dry-run specified; no files were modified."));
    return;
  }

  // Confirm
  if (!opts.yes) {
    // Prompt the user with Node built-ins to avoid extra runtime deps.
    const rl = readline.createInterface({ input, output });
    try {
      const answer =
        (await rl.question(pc.yellow("Apply these changes? (y/N) "))) || "";
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log("Aborted by user.");
        return;
      }
    } catch {
      console.log("\nUpgrade cancelled.");
      return;
    } finally {
      rl.close();
    }
  }

  // Backup and apply
  await fs.ensureDir(path.join(nextellarDir, "backups"));
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(nextellarDir, "backups", ts);
  await fs.ensureDir(backupDir);

  for (const c of changes) {
    if (await fs.pathExists(c.projectFile)) {
      const relPath = path.relative(cwd, c.projectFile);
      const destBackup = path.join(backupDir, relPath);
      await fs.ensureDir(path.dirname(destBackup));
      await fs.copyFile(c.projectFile, destBackup);
    }
    await fs.copyFile(c.templateFile, c.projectFile);
    console.log(pc.green(`Updated ${c.file}`));
  }

  if (Object.keys(pkgChanges).length > 0) {
    const projPkg = await fs.readJson(projPkgPath);
    for (const [pkg, v] of Object.entries(pkgChanges)) {
      if (v.to) {
        if (projPkg.dependencies && pkg in projPkg.dependencies)
          projPkg.dependencies[pkg] = v.to;
        else if (projPkg.devDependencies && pkg in projPkg.devDependencies)
          projPkg.devDependencies[pkg] = v.to;
        else if (!projPkg.dependencies) projPkg.dependencies = { [pkg]: v.to };
      }
    }
    // Backup package.json
    await fs.copyFile(projPkgPath, path.join(backupDir, "package.json"));
    await fs.writeJson(projPkgPath, projPkg, { spaces: 2 });
    console.log(pc.green("Updated package.json dependencies"));
  }

  // Update config nextellarVersion (only reached when changes were actually applied)
  // (also persists any legacy-config migration from above)
  projectConfig.nextellarVersion = cliVersion;
  projectConfig.updatedAt = new Date().toISOString();
  await fs.writeJson(configPath, projectConfig, { spaces: 2 });
  if (migration.migrated) {
    console.log(
      pc.green(
        `Migrated .nextellar/config.json to schema v${PROJECT_CONFIG_SCHEMA_VERSION}`,
      ),
    );
  }

  await recordAuditEvent(cwd, "upgrade", {
    template: templateName,
    fromVersion: currentVersion,
    toVersion: cliVersion,
    filesChanged: changes.map((c) => c.file),
    packagesChanged: pkgChanges,
    backupDir: path.relative(cwd, backupDir),
  });

  console.log(
    pc.green("✔️  Upgrade complete. Backups saved to .nextellar/backups/" + ts),
  );
}

export default upgrade;
