import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { runClean } from '../src/lib/clean';

// #904 — `nextellar clean` removes .nextellar/build artifacts.
describe('runClean (#904)', () => {
  const tmpDirs: string[] = [];
  let logSpy: ReturnType<typeof jest.spyOn> | undefined;

  const makeTempDir = async (): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-clean-test-'));
    tmpDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    // runClean prints status messages; keep test output clean.
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy?.mockRestore();
  });

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it('removes .nextellar/build when it exists', async () => {
    const dir = await makeTempDir();
    const buildDir = path.join(dir, '.nextellar', 'build');
    await fs.outputFile(path.join(buildDir, 'artifact.txt'), 'stale build output');

    const result = await runClean({ cwd: dir });

    expect(result.removed).toBe(true);
    expect(result.targetDir).toBe(buildDir);
    expect(await fs.pathExists(buildDir)).toBe(false);
  });

  it('removes nested files and subdirectories under .nextellar/build', async () => {
    const dir = await makeTempDir();
    const buildDir = path.join(dir, '.nextellar', 'build');
    await fs.outputFile(path.join(buildDir, 'nested', 'deep', 'file.bin'), 'binary-ish');

    await runClean({ cwd: dir });

    expect(await fs.pathExists(buildDir)).toBe(false);
  });

  it('handles a missing .nextellar/build directory gracefully (no-op, no throw)', async () => {
    const dir = await makeTempDir();

    const result = await runClean({ cwd: dir });

    expect(result.removed).toBe(false);
    expect(result.targetDir).toBe(path.join(dir, '.nextellar', 'build'));
    await expect(runClean({ cwd: dir })).resolves.toBeDefined();
  });

  it('handles a project with no .nextellar directory at all', async () => {
    const dir = await makeTempDir();

    const result = await runClean({ cwd: dir });

    expect(result.removed).toBe(false);
    expect(await fs.pathExists(path.join(dir, '.nextellar'))).toBe(false);
  });

  it('only targets .nextellar/build — leaves .nextellar/config.json untouched', async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, '.nextellar', 'config.json');
    await fs.outputJson(configPath, { template: 'default', nextellarVersion: '1.1.0' });
    await fs.outputFile(path.join(dir, '.nextellar', 'build', 'artifact.txt'), 'stale');

    await runClean({ cwd: dir });

    expect(await fs.pathExists(configPath)).toBe(true);
    expect(await fs.readJson(configPath)).toEqual({
      template: 'default',
      nextellarVersion: '1.1.0',
    });
  });

  it('only targets .nextellar/build — leaves .nextellar/deploy and install.log untouched', async () => {
    const dir = await makeTempDir();
    const deployBundle = path.join(dir, '.nextellar', 'deploy', 'bundle.tar.gz');
    const installLog = path.join(dir, '.nextellar', 'install.log');
    await fs.outputFile(deployBundle, 'tarball-bytes');
    await fs.outputFile(installLog, 'install error log');
    await fs.outputFile(path.join(dir, '.nextellar', 'build', 'artifact.txt'), 'stale');

    await runClean({ cwd: dir });

    expect(await fs.pathExists(deployBundle)).toBe(true);
    expect(await fs.pathExists(installLog)).toBe(true);
    expect(await fs.pathExists(path.join(dir, '.nextellar', 'build'))).toBe(false);
  });

  it('never touches source files outside .nextellar', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'src', 'index.ts');
    await fs.outputFile(sourceFile, 'export const hello = "world";\n');
    await fs.outputFile(path.join(dir, '.nextellar', 'build', 'artifact.txt'), 'stale');

    await runClean({ cwd: dir });

    expect(await fs.pathExists(sourceFile)).toBe(true);
    expect(await fs.readFile(sourceFile, 'utf8')).toBe('export const hello = "world";\n');
  });

  it('defaults to process.cwd() when no cwd option is given', async () => {
    const dir = await makeTempDir();
    const buildDir = path.join(dir, '.nextellar', 'build');
    await fs.outputFile(path.join(buildDir, 'artifact.txt'), 'stale');

    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await runClean();
      expect(result.removed).toBe(true);
      expect(await fs.pathExists(buildDir)).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('surfaces a clear error if removal fails unexpectedly', async () => {
    const dir = await makeTempDir();
    const buildDir = path.join(dir, '.nextellar', 'build');
    await fs.outputFile(path.join(buildDir, 'artifact.txt'), 'stale');

    const removeSpy = jest
      .spyOn(fs, 'remove')
      .mockRejectedValueOnce(new Error('EACCES: permission denied'));

    await expect(runClean({ cwd: dir })).rejects.toThrow(
      /Failed to remove \.nextellar\/build.*permission denied/,
    );

    removeSpy.mockRestore();
  });
});
