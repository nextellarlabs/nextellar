import { execa } from "execa";
import path from "path";
import fs from "fs-extra";

export interface InstallOptions {
  cwd: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  timeout?: number;
  skipInstall?: boolean;
  captureOutput?: boolean; // For testing
}

export interface InstallResult {
  success: boolean;
  packageManager: string;
  error?: string;
  logPath?: string;
}

/**
 * Detects the appropriate package manager to use based on:
 * 1. Explicit packageManager option
 * 2. npm_config_user_agent environment variable
 * 3. Presence of lockfiles in the project directory
 * 4. Fallback to npm
 */
export function detectPackageManager(cwd: string, packageManager?: string): 'npm' | 'yarn' | 'pnpm' {
  // 1. Explicit flag takes precedence
  if (packageManager) {
    return packageManager as 'npm' | 'yarn' | 'pnpm';
  }

  // 2. Check npm_config_user_agent (set by package managers when running scripts)
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.includes('yarn')) return 'yarn';
    if (userAgent.includes('pnpm')) return 'pnpm';
    if (userAgent.includes('npm')) return 'npm';
  }

  // 3. Check for lockfiles
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return 'npm';

  // 4. Default to npm
  return 'npm';
}

/**
 * Returns the install command and arguments for the given package manager
 */
export function getInstallCommand(packageManager: 'npm' | 'yarn' | 'pnpm'): [string, string[]] {
  switch (packageManager) {
    case 'npm':
      return ['npm', ['install', '--no-audit', '--no-fund']];
    case 'yarn':
      return ['yarn', ['install', '--non-interactive']];
    case 'pnpm':
      return ['pnpm', ['install', '--no-frozen-lockfile']];
    default:
      return ['npm', ['install', '--no-audit', '--no-fund']];
  }
}

/**
 * Runs package manager installation in the specified directory
 * Streams output to console and handles errors gracefully
 */
export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  const { cwd, timeout = 20 * 60 * 1000, skipInstall = false, captureOutput = false } = options;

  if (skipInstall) {
    return { success: true, packageManager: 'skipped' };
  }

  const packageManager = detectPackageManager(cwd, options.packageManager);
  const [command, args] = getInstallCommand(packageManager);

  console.log(`\n📦 Installing dependencies with ${packageManager}...`);

  try {
    const stdio = captureOutput ? 'pipe' : 'inherit';
    
    await execa(command, args, {
      cwd,
      stdio,
      shell: true,
      timeout,
    });

    console.log(`✅ Dependencies installed successfully with ${packageManager}`);
    return { success: true, packageManager };

  } catch (error: any) {
    const errorMessage = error.message || 'Installation failed';
    console.error(`\n❌ Installation failed with ${packageManager}`);
    
    // Save detailed error log
    const logPath = await saveInstallLog(cwd, error, packageManager);
    
    // Provide helpful remediation instructions
    console.error('\n🔧 To resolve this issue:');
    console.error(`   cd ${path.basename(cwd)}`);
    console.error(`   ${command} ${args.join(' ')}`);
    
    if (logPath) {
      console.error(`\n📝 Full error log saved to: ${path.relative(process.cwd(), logPath)}`);
    }

    return {
      success: false,
      packageManager,
      error: errorMessage,
      logPath,
    };
  }
}

/**
 * Saves installation error log to .nextellar/install.log
 */
async function saveInstallLog(cwd: string, error: any, packageManager: string): Promise<string | undefined> {
  try {
    const nextellarDir = path.join(cwd, '.nextellar');
    await fs.ensureDir(nextellarDir);
    
    const logPath = path.join(nextellarDir, 'install.log');
    const timestamp = new Date().toISOString();
    
    const logContent = [
      `Nextellar Installation Error Log`,
      `Timestamp: ${timestamp}`,
      `Package Manager: ${packageManager}`,
      `Working Directory: ${cwd}`,
      ``,
      `Error Details:`,
      error.message || 'Unknown error',
      ``,
      `Stack Trace:`,
      error.stack || 'No stack trace available',
      ``,
      `Stdout:`,
      error.stdout || 'No stdout captured',
      ``,
      `Stderr:`,
      error.stderr || 'No stderr captured',
    ].join('\n');

    await fs.writeFile(logPath, logContent, 'utf8');
    return logPath;
  } catch (logError) {
    console.warn('⚠️  Could not save error log:', logError);
    return undefined;
  }
}