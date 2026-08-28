/**
 * E2E Test: scaffold-default.e2e.test.ts
 *
 * This test validates the product promise that scaffolded apps are production-ready:
 * - Scaffolds the default template into a temp directory
 * - Verifies all {{PLACEHOLDER}} substitutions are resolved
 * - Runs npm install and next build
 * - Asserts build succeeds with exit code 0
 *
 * USAGE:
 *   NEXTELLAR_E2E=1 npm test -- tests/e2e/scaffold-default.e2e.test.ts
 *
 * This test is SKIPPED BY DEFAULT (gated behind NEXTELLAR_E2E=1) to keep the normal test suite fast.
 * Normal `npm test` will not run this test.
 *
 * REQUIREMENTS:
 * - Node.js 20+ (matches engine requirement)
 * - npm installed
 * - ~2-3 minutes for full install + build cycle
 */

import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { scaffold } from '../../src/lib/scaffold.js';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gate this test behind an environment variable
const shouldRunE2E = process.env.NEXTELLAR_E2E === '1';

// Extend timeout for full install + build cycle
jest.setTimeout(300000); // 5 minutes

// Helper to check if any file contains literal placeholder syntax
async function findUnresolvedPlaceholders(dir: string): Promise<string[]> {
  const findings: string[] = [];
  const filesToCheck = [
    'package.json',
    'README.md',
    '.env.example',
    '.nextellar/config.json',
    'src/contexts/WalletProvider.tsx',
    'src/lib/stellar-wallet-kit.ts',
    'src/hooks/useSorobanContract.ts',
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.join(dir, relPath);
    if (await fs.pathExists(fullPath)) {
      const content = await fs.readFile(fullPath, 'utf8');
      // Match any remaining {{ ... }} placeholders
      const matches = content.match(/\{\{[^}]+\}\}/g);
      if (matches && matches.length > 0) {
        findings.push(`${relPath}: ${matches.join(', ')}`);
      }
    }
  }

  return findings;
}

(shouldRunE2E ? describe : describe.skip)('E2E: scaffold + install + build (default template)', () => {
  let tmpDir: string;
  let appDir: string;
  const appName = 'e2e-test-app';

  beforeAll(async () => {
    // Create temp directory for the test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-e2e-'));
    appDir = path.join(tmpDir, appName);
  });

  afterAll(async () => {
    // Cleanup temp directory
    if (tmpDir && await fs.pathExists(tmpDir)) {
      try {
        await fs.remove(tmpDir);
      } catch (error) {
        console.warn(`Failed to cleanup temp directory ${tmpDir}:`, error);
      }
    }
  });

  test('scaffold default template with install enabled', async () => {
    const origCwd = process.cwd();

    try {
      // Change to temp directory for scaffolding
      process.chdir(tmpDir);

      // Scaffold with install enabled (this will run npm install)
      await scaffold({
        appName,
        useTs: true,
        template: undefined, // uses default
        skipInstall: false, // Enable installation
        telemetryEnabled: false,
      });

      // Verify the app directory was created
      expect(await fs.pathExists(appDir)).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  test('verify .env.example exists and has no placeholders', async () => {
    const envPath = path.join(appDir, '.env.example');
    expect(await fs.pathExists(envPath)).toBe(true);

    const envContent = await fs.readFile(envPath, 'utf8');
    expect(envContent).not.toMatch(/\{\{[^}]+\}\}/);
    expect(envContent).toContain('NEXT_PUBLIC_HORIZON_URL=');
    expect(envContent).toContain('NEXT_PUBLIC_SOROBAN_URL=');
    expect(envContent).toContain('NEXT_PUBLIC_NETWORK=');
  });

  test('verify .nextellar/config.json exists and has no placeholders', async () => {
    const configPath = path.join(appDir, '.nextellar/config.json');
    
    // .nextellar/config.json is in filesToProcess but may not exist in template
    // If it exists, verify no placeholders remain
    if (await fs.pathExists(configPath)) {
      const configContent = await fs.readFile(configPath, 'utf8');
      expect(configContent).not.toMatch(/\{\{[^}]+\}\}/);
    }
  });

  test('verify all {{PLACEHOLDER}} substitutions are resolved', async () => {
    const unresolvedPlaceholders = await findUnresolvedPlaceholders(appDir);
    
    if (unresolvedPlaceholders.length > 0) {
      console.error('Found unresolved placeholders:');
      unresolvedPlaceholders.forEach((finding) => console.error(`  - ${finding}`));
    }
    
    expect(unresolvedPlaceholders).toEqual([]);
  });

  test('verify node_modules exists (install succeeded)', async () => {
    const nodeModulesPath = path.join(appDir, 'node_modules');
    expect(await fs.pathExists(nodeModulesPath)).toBe(true);
    
    // Verify key dependencies are installed
    expect(await fs.pathExists(path.join(nodeModulesPath, 'next'))).toBe(true);
    expect(await fs.pathExists(path.join(nodeModulesPath, 'react'))).toBe(true);
  });

  test('run next build and verify exit code 0', async () => {
    let buildOutput = '';
    let buildError = '';

    try {
      const result = await execa('npm', ['run', 'build'], {
        cwd: appDir,
        timeout: 180000, // 3 minutes timeout for build
        env: {
          ...process.env,
          NODE_ENV: 'production',
        },
      });

      buildOutput = result.stdout;
      buildError = result.stderr;

      // Assert build succeeded
      expect(result.exitCode).toBe(0);

      // Verify build artifacts were created
      const buildDir = path.join(appDir, '.next');
      expect(await fs.pathExists(buildDir)).toBe(true);

      console.log('✅ Build succeeded');
    } catch (error: any) {
      // Capture output even on failure
      buildOutput = error.stdout || '';
      buildError = error.stderr || '';

      console.error('\n❌ Build failed!');
      console.error('\n--- Build stdout ---');
      console.error(buildOutput);
      console.error('\n--- Build stderr ---');
      console.error(buildError);
      console.error('\n--- Error details ---');
      console.error(error);

      // Re-throw to fail the test
      throw new Error(
        `next build failed with exit code ${error.exitCode}. See output above for details.`
      );
    }
  });
});
