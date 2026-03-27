import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

interface UpgradeOptions {
  dryRun?: boolean;
  yes?: boolean;
}

const STELLAR_PKGS = [
  "@stellar/stellar-sdk",
  "@creit.tech/stellar-wallets-kit",
];

function findTemplateDir(templateName: string) {
  const base = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
  );
  const devPath = path.resolve(base, "../../templates", templateName);
  const prodPath = path.resolve(base, "../../../src/templates", templateName);
  return fs.existsSync(devPath) ? devPath : prodPath;
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
  const changes: { file: string; projectFile: string; templateFile: string }[] = [];
  for (const rel of candidates) {
    const templateFile = path.join(templateSrc, rel);
    const projectFile = path.join(cwd, "src", rel);
    if (!(await fs.pathExists(projectFile))) {
      // New file - include
      changes.push({ file: rel, projectFile, templateFile });
      continue;
    }
    const [a, b] = await Promise.all([
      fs.readFile(templateFile, "utf8"),
      fs.readFile(projectFile, "utf8"),
    ]);
    if (a !== b) changes.push({ file: rel, projectFile, templateFile });
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

  // Summary
  console.log(pc.cyan("Nextellar Upgrade"));
  console.log(`Project template: ${pc.bold(templateName)}`);
  console.log(`Current Nextellar version: ${pc.bold(currentVersion)}`);
  console.log("");

  if (changes.length === 0 && Object.keys(pkgChanges).length === 0) {
    console.log(pc.green("✔️  No template updates to apply."));
    return;
  }

  console.log(pc.yellow("Files to be updated:"));
  for (const c of changes) console.log(` - ${c.file}`);
  for (const [k, v] of Object.entries(pkgChanges)) console.log(` - package.json: ${k} ${v.from || "(new)"} → ${v.to}`);

  if (opts.dryRun) {
    console.log("");
    console.log(pc.magenta("--dry-run specified; no files were modified."));
    return;
  }

  // Confirm
  if (!opts.yes) {
    // Prompt the user with Node built-ins to avoid extra runtime deps.
    const rl = readline.createInterface({ input, output });
    const answer =
      (await rl.question(pc.yellow("Apply these changes? (y/N) "))) || "";
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Aborted by user.");
      return;
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

  // Update config nextellarVersion
  try {
    const myPkg = await fs.readJson(path.join(path.dirname(new URL(import.meta.url).pathname), "../../package.json"));
    projectConfig.nextellarVersion = myPkg.version || projectConfig.nextellarVersion;
    projectConfig.updatedAt = new Date().toISOString();
    await fs.writeJson(configPath, projectConfig, { spaces: 2 });
  } catch (e) {
    // ignore
  }

  console.log(pc.green("✔️  Upgrade complete. Backups saved to .nextellar/backups/" + ts));
}

export default upgrade;
