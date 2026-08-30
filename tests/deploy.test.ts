import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { list, extract } from 'tar';

import { runDeploy } from '../src/lib/deploy';

jest.setTimeout(30000);

// #669 — createBundle() uses the `tar` npm package (no system `tar` binary).
// These tests prove the excluded directories never enter the archive and that
// the bundle round-trips, exercising the real tar library end-to-end through
// the public runDeploy() entrypoint.
describe('deploy bundle (#669)', () => {
  const tmpDirs: string[] = [];
  let logSpy: ReturnType<typeof jest.spyOn> | undefined;

  // A minimal but valid Next.js project: `next` dependency + a `.next` build
  // dir (both required by validateProject), seeded with files that must ship
  // and directories that must be excluded.
  const makeProject = async (): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-deploy-test-'));
    tmpDirs.push(dir);

    await fs.writeJson(path.join(dir, 'package.json'), {
      name: 'deploy-fixture',
      dependencies: { next: '^14.0.0' },
    });

    // Real project content — must be present in the bundle.
    await fs.outputFile(path.join(dir, 'src/index.ts'), 'export const hello = "world";\n');
    await fs.outputFile(path.join(dir, 'app/page.tsx'), 'export default function Page() { return null; }\n');
    await fs.outputFile(path.join(dir, '.next/BUILD_ID'), 'abc123');
    // Sibling of an excluded path — proves exclusion is precise, not greedy.
    await fs.outputFile(path.join(dir, '.next/server/page.js'), 'server');
    await fs.outputFile(path.join(dir, '.nextellar/config.json'), '{}');

    // Must be excluded.
    await fs.outputFile(path.join(dir, 'node_modules/left-pad/index.js'), 'junk');
    await fs.outputFile(path.join(dir, '.git/config'), '[core]');
    await fs.outputFile(path.join(dir, '.next/cache/blob.bin'), 'cache');
    await fs.outputFile(path.join(dir, '.nextellar/deploy/old-bundle.tar.gz'), 'stale');

    return dir;
  };

  // node-tar prefixes entry paths with "./" and appends "/" to directories;
  // normalise to bare, forward-slash paths for assertions.
  const listEntries = async (bundlePath: string): Promise<string[]> => {
    const entries: string[] = [];
    await list({
      file: bundlePath,
      onentry: (e) => entries.push(e.path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')),
    });
    return entries.filter(Boolean);
  };

  const runAndGetBundle = async (projectDir: string): Promise<string> => {
    await runDeploy({ cwd: projectDir });
    const state = await fs.readJson(
      path.join(projectDir, '.nextellar', 'deploy', 'latest-bundle.json'),
    );
    expect(await fs.pathExists(state.bundlePath)).toBe(true);
    return state.bundlePath as string;
  };

  beforeEach(() => {
    // runDeploy is chatty; keep test output clean.
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy?.mockRestore();
  });

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it('creates a non-empty bundle (no system tar binary required)', async () => {
    const projectDir = await makeProject();
    const bundlePath = await runAndGetBundle(projectDir);
    const stats = await fs.stat(bundlePath);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('excludes node_modules, .git, .next/cache and .nextellar/deploy', async () => {
    const projectDir = await makeProject();
    const entries = await listEntries(await runAndGetBundle(projectDir));

    const excluded = ['node_modules', '.git', '.next/cache', '.nextellar/deploy'];
    for (const entry of entries) {
      for (const pattern of excluded) {
        expect(entry === pattern || entry.startsWith(`${pattern}/`)).toBe(false);
      }
    }

    expect(entries).not.toContain('node_modules/left-pad/index.js');
    expect(entries).not.toContain('.git/config');
    expect(entries).not.toContain('.next/cache/blob.bin');
    expect(entries).not.toContain('.nextellar/deploy/old-bundle.tar.gz');
  });

  it('keeps real files and the siblings of excluded paths', async () => {
    const projectDir = await makeProject();
    const entries = await listEntries(await runAndGetBundle(projectDir));

    expect(entries).toContain('package.json');
    expect(entries).toContain('src/index.ts');
    expect(entries).toContain('app/page.tsx');
    // .next/server survives even though .next/cache is excluded.
    expect(entries).toContain('.next/server/page.js');
    // .nextellar/config.json survives even though .nextellar/deploy is excluded.
    expect(entries).toContain('.nextellar/config.json');
  });

  it('round-trips: the bundle extracts and file contents match', async () => {
    const projectDir = await makeProject();
    const bundlePath = await runAndGetBundle(projectDir);

    const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-deploy-extract-'));
    tmpDirs.push(extractDir);
    await extract({ file: bundlePath, cwd: extractDir });

    expect(await fs.readFile(path.join(extractDir, 'src/index.ts'), 'utf8')).toBe(
      'export const hello = "world";\n',
    );
    const pkg = await fs.readJson(path.join(extractDir, 'package.json'));
    expect(pkg.dependencies.next).toBe('^14.0.0');
    // Excluded content is absent after a real extraction too.
    expect(await fs.pathExists(path.join(extractDir, 'node_modules'))).toBe(false);
  });
});

// #641 — validation failures, dry-run safety, and the persisted deploy state,
// exercised through the public runDeploy() entrypoint against the real tar
// library (deploy no longer shells out to execa, so these use no execa mock).
describe('runDeploy validation & state (#641)', () => {
  const tmpDirs: string[] = [];
  let logSpy: ReturnType<typeof jest.spyOn> | undefined;

  const makeTempDir = async (): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-deploy-state-'));
    tmpDirs.push(dir);
    return dir;
  };

  // A minimal valid Next.js project: package.json with `next` + a `.next` dir.
  const makeValidProject = async (name: string, withContracts = false): Promise<string> => {
    const dir = await makeTempDir();
    await fs.writeJson(path.join(dir, 'package.json'), {
      name,
      dependencies: { next: '^14.0.0' },
    });
    await fs.ensureDir(path.join(dir, '.next'));
    if (withContracts) {
      await fs.outputFile(path.join(dir, 'contracts', 'hello.rs'), '// stub');
    }
    return dir;
  };

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy?.mockRestore();
  });

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it('rejects a directory without package.json', async () => {
    const dir = await makeTempDir();
    await expect(runDeploy({ cwd: dir })).rejects.toThrow(/No package\.json found/i);
  });

  it('rejects a project without a next dependency', async () => {
    const dir = await makeTempDir();
    await fs.writeJson(path.join(dir, 'package.json'), { name: 'no-next', dependencies: {} });
    await expect(runDeploy({ cwd: dir })).rejects.toThrow(/not a Next\.js project/i);
  });

  it('rejects when the .next build output is missing', async () => {
    const dir = await makeTempDir();
    await fs.writeJson(path.join(dir, 'package.json'), {
      name: 'no-build',
      dependencies: { next: '^14.0.0' },
    });
    await expect(runDeploy({ cwd: dir })).rejects.toThrow(/Missing production build/i);
  });

  it('--dry-run performs no writes (no .nextellar/deploy/ is created)', async () => {
    const dir = await makeValidProject('dry-run-app');
    await runDeploy({ cwd: dir, dryRun: true });
    expect(await fs.pathExists(path.join(dir, '.nextellar', 'deploy'))).toBe(false);
  });

  it('writes latest-bundle.json with bundlePath, bundleSizeBytes, hasContracts and createdAt', async () => {
    const dir = await makeValidProject('success-app', true);
    const before = Date.now();

    await runDeploy({ cwd: dir });

    const state = await fs.readJson(
      path.join(dir, '.nextellar', 'deploy', 'latest-bundle.json'),
    );
    expect(typeof state.bundlePath).toBe('string');
    expect(path.isAbsolute(state.bundlePath)).toBe(true);
    expect(state.bundlePath).toContain('.nextellar');
    expect(await fs.pathExists(state.bundlePath)).toBe(true);
    expect(typeof state.bundleSizeBytes).toBe('number');
    expect(state.bundleSizeBytes).toBeGreaterThan(0);
    expect(state.hasContracts).toBe(true);
    expect(typeof state.createdAt).toBe('string');
    const createdAtMs = new Date(state.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    expect(createdAtMs).toBeLessThanOrEqual(Date.now());
  });

  it('sets hasContracts to false when no contracts directory exists', async () => {
    const dir = await makeValidProject('no-contracts-app', false);
    await runDeploy({ cwd: dir });
    const state = await fs.readJson(
      path.join(dir, '.nextellar', 'deploy', 'latest-bundle.json'),
    );
    expect(state.hasContracts).toBe(false);
  });
});
