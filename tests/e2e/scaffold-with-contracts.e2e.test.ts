import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { scaffold } from '../../src/lib/scaffold.js';

const execFileAsync = promisify(execFile);

jest.setTimeout(20 * 60 * 1000);

const RUN_E2E = process.env.NEXTELLAR_E2E === '1' || process.env.RUN_E2E === '1';
const describeE2E = RUN_E2E ? describe : describe.skip;

/**
 * These tests scaffold a real app and run `next build` against it, so they
 * hit npm and the network. Gated behind NEXTELLAR_E2E=1 (or RUN_E2E=1) to
 * keep `npm test` fast.
 */
describeE2E('e2e: --with-contracts overlay scaffold (Soroban)', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it('scaffolds with the contracts overlay and builds successfully', async () => {
    const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-e2e-contracts-'));
    tmpDirs.push(parentDir);
    const appName = 'contracts-app';
    const appDir = path.join(parentDir, appName);

    const origCwd = process.cwd();
    process.chdir(parentDir);
    try {
      await scaffold({
        appName,
        useTs: true,
        withContracts: true,
        skipInstall: true,
        telemetryEnabled: false,
      });
    } finally {
      process.chdir(origCwd);
    }

    // The Soroban contracts overlay is copied in
    expect(await fs.pathExists(path.join(appDir, 'src/lib/contracts'))).toBe(true);
    expect(await fs.pathExists(path.join(appDir, 'contracts'))).toBe(true);

    // Placeholders resolved
    const pkgJson = await fs.readJson(path.join(appDir, 'package.json'));
    expect(pkgJson.name).toBe(appName);
    expect(pkgJson.scripts).toMatchObject({
      'contracts:build': 'cd contracts && stellar contract build',
      'contracts:test': 'cd contracts && cargo test',
    });

    const envExample = await fs.readFile(path.join(appDir, '.env.example'), 'utf8');
    expect(envExample).not.toMatch(/\{\{.*\}\}/);

    // Install and build for real
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: appDir,
      shell: true,
    });
    await execFileAsync('npm', ['run', 'build'], { cwd: appDir, shell: true });
  });
});
