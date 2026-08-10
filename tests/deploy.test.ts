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
