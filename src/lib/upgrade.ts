import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "url";

interface UpgradeOptions {
  dryRun?: boolean;
  yes?: boolean;
  check?: boolean;
}

const STELLAR_PKGS = [
  "@stellar/stellar-sdk",
  "@creit.tech/stellar-wallets-kit",
];

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
  const base = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
  );
  // src/lib/upgrade.ts, dist/src/lib/upgrade.js and a bundled dist/templates
  // all resolve the template from a different depth.
  const candidates = [
    path.resolve(base, "../templates", templateName),
    path.resolve(base, "../../templates", templateName),
    path.resolve(base, "../../../src/templates", templateName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[candidates.length - 1];
}

export async function upgrade(opts: UpgradeOptions = {}) {
  const cwd = process.cwd();

  // Detect Nextellar project marker
  const nextellarDir = path.join(cwd, ".nextellar");
  const configPath = path.join(nextellarDir, "config.json");

  if (!(await fs.pathExists(configPath))) {
    throw new Error("Not a Nextellar project: missing .nextellar/config.json");
  }

  const projectConfig = await fs.readJson(configPath).catch(() => ({}));
  const templateName = projectConfig.template || "default";
  const currentVersion = projectConfig.nextellarVersion || "unknown";

  const myPkg = await fs.readJson(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"),
  );
  const cliVersion: string = myPkg.version || "0.0.0";

  console.log(pc.cyan("Nextellar Upgrade"));
  console.log(`Project template: ${pc.bold(templateName)}`);
  console.log(`${currentVersion} -> ${cliVersion}`);
  console.log("");

  if (currentVersion !== "unknown" && compareVersions(cliVersion, currentVersion) < 0) {
    console.log(
      pc.red(
        `⚠️  Installed Nextellar CLI (${cliVersion}) is older than this project (${currentVersion}).`,
      ),
    );
    console.log(
      pc.red("Upgrading would downgrade project files. Update the CLI first."),
    );
    if (!opts.yes) {
      console.log(pc.yellow("Re-run with --yes to proceed anyway."));
      return;
    }
    console.log(pc.yellow("--yes specified; proceeding despite the downgrade."));
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
      for (const f of files) {
        const full = path.join(dir, f);
        const stat = await fs.stat(full);
        if (stat.isFile()) candidates.push(path.join(sub, f));
      }
    }
  }

  // Compare and collect diffs
  const changes: { file: string; projectFile: string; templateFile: string; status: "added" | "updated" }[] = [];
  let unchangedCount = 0;
  for (const rel of candidates) {
    const templateFile = path.join(templateSrc, rel);
    const projectFile = path.join(cwd, "src", rel);
    if (!(await fs.pathExists(projectFile))) {
      changes.push({ file: rel, projectFile, templateFile, status: "added" });
      continue;
    }
    const [a, b] = await Promise.all([
      fs.readFile(templateFile, "utf8"),
      fs.readFile(projectFile, "utf8"),
    ]);
    if (a !== b) {
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
    const tplDeps = { ...(tplPkg.dependencies || {}), ...(tplPkg.devDependencies || {}) };
    const projDeps = { ...(projPkg.dependencies || {}), ...(projPkg.devDependencies || {}) };
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
  for (const [k, v] of Object.entries(pkgChanges)) console.log(` - package.json: ${k} ${v.from || "(new)"} → ${v.to}`);
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
      }
    }
  }

  if (opts.check) {
    console.log("");
    console.log(pc.magenta("--check specified; dry preview only. No files were modified."));
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
        if (projPkg.dependencies && pkg in projPkg.dependencies) projPkg.dependencies[pkg] = v.to;
        else if (projPkg.devDependencies && pkg in projPkg.devDependencies) projPkg.devDependencies[pkg] = v.to;
        else if (!projPkg.dependencies) projPkg.dependencies = { [pkg]: v.to };
      }
    }
    // Backup package.json
    await fs.copyFile(projPkgPath, path.join(backupDir, "package.json"));
    await fs.writeJson(projPkgPath, projPkg, { spaces: 2 });
    console.log(pc.green("Updated package.json dependencies"));
  }

  // Update config nextellarVersion (only reached when changes were actually applied)
  projectConfig.nextellarVersion = cliVersion;
  projectConfig.updatedAt = new Date().toISOString();
  await fs.writeJson(configPath, projectConfig, { spaces: 2 });

  console.log(pc.green("✔️  Upgrade complete. Backups saved to .nextellar/backups/" + ts));
}

export default upgrade;
