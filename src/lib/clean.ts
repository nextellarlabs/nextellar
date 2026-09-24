import path from "path";
import fs from "fs-extra";
import pc from "picocolors";

export interface CleanOptions {
  /** Directory to run from; defaults to process.cwd(). */
  cwd?: string;
}

export interface CleanResult {
  /** Absolute path to the artifact directory that was targeted. */
  targetDir: string;
  /** Whether the directory existed and was removed. */
  removed: boolean;
}

/**
 * Removes the `.nextellar/build` artifact directory for the current project.
 *
 * Only ever targets `<cwd>/.nextellar/build` — it never touches source
 * files, `.nextellar/config.json`, or any other `.nextellar/*` state (e.g.
 * `deploy/`, `install.log`). Safe to run when the directory doesn't exist.
 */
export async function runClean(options: CleanOptions = {}): Promise<CleanResult> {
  const cwd = options.cwd || process.cwd();
  const targetDir = path.join(cwd, ".nextellar", "build");

  const exists = await fs.pathExists(targetDir);

  if (!exists) {
    console.log(pc.yellow("ℹ️  Nothing to clean — .nextellar/build does not exist."));
    return { targetDir, removed: false };
  }

  try {
    await fs.remove(targetDir);
  } catch (err: any) {
    throw new Error(
      `Failed to remove .nextellar/build: ${err?.message || err}`,
    );
  }

  console.log(pc.green("✔️  Removed .nextellar/build"));
  return { targetDir, removed: true };
}
