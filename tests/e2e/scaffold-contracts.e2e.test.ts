/**
 * E2E Test: scaffold-contracts.e2e.test.ts (#863)
 *
 * Validates that `--with-contracts` scaffolds a project whose Soroban
 * contract overlay installs and builds end-to-end:
 * - Scaffolds with withContracts: true into a temp directory
 * - Asserts the contracts overlay landed (contracts/Cargo.toml, hello_world)
 * - Runs npm install
 * - Builds the Soroban contract (stellar contract build / cargo check)
 *
 * USAGE:
 *   NEXTELLAR_E2E=1 npm test -- tests/e2e/scaffold-contracts.e2e.test.ts
 *
 * REQUIREMENTS:
 * - Node.js 20+, npm, Rust toolchain (cargo) and stellar CLI on PATH
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import { scaffold } from '../../src/lib/scaffold.js';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shouldRunE2E = process.env.NEXTELLAR_E2E === '1';
const d = shouldRunE2E ? describe : describe.skip;

const APP_NAME = 'coldchain-app';

d('scaffold --with-contracts E2E (#863)', () => {
  let tmpDir: string;
  let appDir: string;
  let origCwd: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-e2e-863-'));
    appDir = path.join(tmpDir, APP_NAME);
    origCwd = process.cwd();
    process.chdir(tmpDir); // scaffold() writes relative to cwd
  });

  afterAll(async () => {
    process.chdir(origCwd);
    if (tmpDir && process.env.KEEP_E2E_OUTPUT !== '1') {
      await fs
        .remove(tmpDir)
        .catch((e) =>
          console.warn(`Failed to cleanup ${tmpDir}:`, e.message),
        );
    }
  }, 120000);

  test('scaffold withContracts copies the overlay and registers scripts', async () => {
    await scaffold({
      appName: APP_NAME,
      useTs: true,
      withContracts: true,
      skipInstall: true,
      defaults: true,
      telemetryEnabled: false,
    });

    // Overlay files landed
    expect(
      await fs.pathExists(path.join(appDir, 'contracts', 'Cargo.toml')),
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(appDir, 'contracts', 'hello_world', 'src', 'lib.rs'),
      ),
    ).toBe(true);

    // package.json gained the contracts scripts
    const pkg = await fs.readJson(path.join(appDir, 'package.json'));
    expect(pkg.scripts['contracts:build']).toContain('stellar contract build');
    expect(pkg.scripts['contracts:test']).toContain('cargo test');
  });

  test('npm install succeeds in the scaffolded app', async () => {
    await execa(
      'npm',
      ['install', '--ignore-scripts'],
      {
        cwd: appDir,
        timeout: 240000,
        env: { ...process.env, npm_config_allow_scripts: '' },
      },
    );
    expect(await fs.pathExists(path.join(appDir, 'node_modules'))).toBe(true);
  }, 300000);

  test('soroban contract builds (stellar contract build or cargo check)', async () => {
    const contractsDir = path.join(appDir, 'contracts');

    // Prefer the documented script path; fall back to plain cargo check.
    try {
      await execa('stellar', ['contract', 'build'], {
        cwd: contractsDir,
        timeout: 300000,
      });
    } catch {
      await execa('cargo', ['check'], {
        cwd: path.join(contractsDir, 'hello_world'),
        timeout: 300000,
      });
    }

    // stellar contract build compiles the workspace; artifacts land in
    // contracts/target (wasm32v1-none/debug or release)
    const workspaceTarget = path.join(contractsDir, 'target');
    const helloTarget = path.join(contractsDir, 'hello_world', 'target');
    const compiled =
      (await fs.pathExists(workspaceTarget)) ||
      (await fs.pathExists(helloTarget));
    expect(compiled).toBe(true);
  }, 600000);
});
