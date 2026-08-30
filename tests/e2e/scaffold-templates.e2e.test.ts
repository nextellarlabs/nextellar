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
 * These tests scaffold real apps and run `next build` against them, so they
 * hit npm and the network. Gated behind RUN_E2E=1 to keep `npm test` fast.
 */
describeE2E('e2e: template scaffolds build successfully', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  const cases: {
    template: string;
    appName: string;
    expectHooks: string[];
    unexpectedHooks: string[];
  }[] = [
    {
      template: 'minimal',
      appName: 'minimal-app',
      expectHooks: ['useStellarWallet.ts', 'useStellarBalances.ts'],
      unexpectedHooks: ['useTrustlines.ts', 'useOfferBook.ts'],
    },
    {
      template: 'defi',
      appName: 'defi-app',
      expectHooks: ['useOfferBook.ts', 'useTrustlines.ts'],
      unexpectedHooks: [],
    },
  ];

  it.each(cases)(
    '$template: scaffolds, resolves placeholders, ships expected hooks, and builds',
    async ({ template, appName, expectHooks, unexpectedHooks }) => {
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), `nextellar-e2e-${template}-`));
      tmpDirs.push(parentDir);
      const appDir = path.join(parentDir, appName);

      const origCwd = process.cwd();
      process.chdir(parentDir);
      try {
        await scaffold({
          appName,
          useTs: true,
          template,
          skipInstall: true,
          telemetryEnabled: false,
        });
      } finally {
        process.chdir(origCwd);
      }

      // Placeholder substitution
      const pkgJson = await fs.readJson(path.join(appDir, 'package.json'));
      expect(pkgJson.name).toBe(appName);

      // .env.example present
      expect(await fs.pathExists(path.join(appDir, '.env.example'))).toBe(true);
      const envExample = await fs.readFile(path.join(appDir, '.env.example'), 'utf8');
      expect(envExample).not.toMatch(/\{\{.*\}\}/);

      // Template-specific hook set
      const hooksDir = path.join(appDir, 'src/hooks');
      const hookFiles = await fs.readdir(hooksDir);
      for (const hook of expectHooks) {
        expect(hookFiles).toContain(hook);
      }
      for (const hook of unexpectedHooks) {
        expect(hookFiles).not.toContain(hook);
      }

      // Install and build for real
      await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: appDir,
        shell: true,
      });
      await execFileAsync('npm', ['run', 'build'], { cwd: appDir, shell: true });
    }
  );
});
