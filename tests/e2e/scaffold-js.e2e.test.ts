import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { scaffold } from '../../src/lib/scaffold.js';

const execFileAsync = promisify(execFile);

jest.setTimeout(20 * 60 * 1000);

const RUN_E2E = process.env.RUN_E2E === '1';
const describeE2E = RUN_E2E ? describe : describe.skip;

/**
 * These tests scaffold a real app and run `next build` against it, so they
 * hit npm and the network. Gated behind RUN_E2E=1 to keep `npm test` fast.
 */
describeE2E('e2e: --javascript scaffold', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it('scaffolds, has no stray TS files, and builds successfully', async () => {
    const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-e2e-js-'));
    tmpDirs.push(parentDir);
    const appName = 'js-app';
    const appDir = path.join(parentDir, appName);

    const origCwd = process.cwd();
    process.chdir(parentDir);
    try {
      await scaffold({
        appName,
        useTs: false,
        skipInstall: true,
        telemetryEnabled: false,
      });
    } finally {
      process.chdir(origCwd);
    }

    // jsconfig.json present; no stray .ts/.tsx source files
    expect(await fs.pathExists(path.join(appDir, 'jsconfig.json'))).toBe(true);

    const strayTsFiles: string[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          strayTsFiles.push(full);
        }
      }
    };
    await walk(appDir);
    expect(strayTsFiles).toEqual([]);

    // Placeholders resolved
    const pkgJson = await fs.readJson(path.join(appDir, 'package.json'));
    expect(pkgJson.name).toBe(appName);

    const readme = await fs.readFile(path.join(appDir, 'README.md'), 'utf8');
    expect(readme).not.toContain('{{APP_NAME}}');

    const walletKit = await fs.readFile(
      path.join(appDir, 'src/lib/stellar-wallet-kit.js'),
      'utf8'
    );
    expect(walletKit).not.toContain('{{NETWORK}}');

    // Install and build for real
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: appDir,
      shell: true,
    });
    await execFileAsync('npm', ['run', 'build'], { cwd: appDir, shell: true });
  });
});
