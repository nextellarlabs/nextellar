import fs from 'fs-extra';
import { jest } from '@jest/globals';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { scaffold } from '../src/lib/scaffold';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.setTimeout(30000);

describe('scaffold integration', () => {
  let origCwd: string | undefined;
  const tmpParents: string[] = [];

  const makeTempParent = async (prefix = 'nextellar-test-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tmpParents.push(dir);
    return dir;
  };

  const expectCopyPhaseFailure = async (appName: string) => {
    const copySpy = jest.spyOn(fs, 'copy').mockImplementation(async (_source, destination) => {
      const targetDir = path.resolve(destination.toString());
      await fs.ensureDir(targetDir);
      await fs.writeFile(path.join(targetDir, 'partial.txt'), 'partial scaffold');
      throw new Error('copy phase failed');
    });

    try {
      await expect(
        scaffold({
          appName,
          useTs: true,
          template: 'minimal',
          skipInstall: true,
        }),
      ).rejects.toThrow('copy phase failed');
    } finally {
      copySpy.mockRestore();
    }
  };

  afterEach(async () => {
    // restore cwd
    if (origCwd) process.chdir(origCwd);
    // cleanup all temp parents
    await Promise.all(
      tmpParents.map(async (p) => {
        try {
          await fs.remove(p);
        } catch (e) {
          // ignore
        }
      })
    );
    tmpParents.length = 0;
  });

  test('scaffolds minimal template and substitutes placeholders (default values)', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'My Special App';

    await scaffold({
      appName,
      useTs: true,
      template: 'minimal',
      skipInstall: true,
    });

    const target = path.join(parent, appName);
    expect(await fs.pathExists(target)).toBe(true);

    // README should have app name substituted
    const readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain(`# ${appName}`);

    // .env.example should contain default horizon and app name
    const envExample = await fs.readFile(path.join(target, '.env.example'), 'utf8');
    expect(envExample).toContain('NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org');
    expect(envExample).toContain(`NEXT_PUBLIC_APP_NAME=${appName}`);
    expect(envExample).toContain('NEXT_PUBLIC_NETWORK=TESTNET');

    // stellar-wallet-kit should have injected default wallets and NETWORK should be TESTNET
    const kitFile = await fs.readFile(path.join(target, 'src/lib/stellar-wallet-kit.ts'), 'utf8');
    expect(kitFile).toContain(
      'const INJECTED_WALLETS: string[] = ["freighter", "albedo", "lobstr"];',
    );
  });

  test('injects custom URLs and wallet list and sets NETWORK=PUBLIC when horizon contains public', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'custom-app';
    const horizon = 'https://horizon-public.stellar.org';
    const soroban = 'https://custom-soroban.example';
    const wallets = ['freighter', 'xbull'];

    await scaffold({
      appName,
      useTs: true,
      template: 'minimal',
      horizonUrl: horizon,
      sorobanUrl: soroban,
      wallets,
      skipInstall: true,
    });

    const target = path.join(parent, appName);
    const envExample = await fs.readFile(path.join(target, '.env.example'), 'utf8');
    expect(envExample).toContain(`NEXT_PUBLIC_HORIZON_URL=${horizon}`);
    expect(envExample).toContain(`NEXT_PUBLIC_SOROBAN_URL=${soroban}`);
    expect(envExample).toContain('NEXT_PUBLIC_NETWORK=PUBLIC');

    const kitFile = await fs.readFile(path.join(target, 'src/lib/stellar-wallet-kit.ts'), 'utf8');
    expect(kitFile).toContain("network: ('PUBLIC' as string) === 'PUBLIC'");
  });

  test('uses the default TypeScript template when no template is provided', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'default-template-app';

    await scaffold({
      appName,
      useTs: true,
      skipInstall: true,
    });

    const target = path.join(parent, appName);
    expect(await fs.pathExists(path.join(target, 'tsconfig.json'))).toBe(true);

    const packageJson = await fs.readJson(path.join(target, 'package.json'));
    expect(packageJson.name).toBe(appName);
  });

  test('removes the target directory after a copy-phase failure', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'copy-failure-cleanup';
    const target = path.join(parent, appName);

    await expectCopyPhaseFailure(appName);

    expect(await fs.pathExists(target)).toBe(false);
  });

  test('keeps files outside the target directory after a copy-phase failure', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'copy-failure-boundary';
    const outsideFile = path.join(parent, 'sibling-data', 'keep.txt');
    await fs.outputFile(outsideFile, 'keep this file');

    await expectCopyPhaseFailure(appName);

    expect(await fs.readFile(outsideFile, 'utf8')).toBe('keep this file');
  });

  test('throws when target directory already exists without force and leaves it untouched', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'already-exists-app';
    const target = path.join(parent, appName);
    await fs.ensureDir(target);
    const existingFile = path.join(target, 'existing.txt');
    await fs.writeFile(existingFile, 'keep this project');

    await expect(
      scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      })
    ).rejects.toThrow(/already exists/i);

    expect(await fs.readFile(existingFile, 'utf8')).toBe('keep this project');
  });

  test('replaces an existing directory with the default scaffold when force and defaults are enabled', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'force-overwrite-app';
    const target = path.join(parent, appName);
    const legacyFile = path.join(target, 'legacy.txt');
    await fs.outputFile(legacyFile, 'old project contents');

    await scaffold({
      appName,
      useTs: true,
      force: true,
      defaults: true,
      skipInstall: true,
    });

    expect(await fs.pathExists(target)).toBe(true);
    expect(await fs.pathExists(legacyFile)).toBe(false);
    expect(await fs.readFile(path.join(target, 'README.md'), 'utf8')).toContain(`# ${appName}`);
  });

  test('.git and node_modules are excluded from copy', async () => {
    // Determine template dir the same way scaffold does
    const scaffoldModulePath = path.resolve(__dirname, '../src/lib/scaffold.ts');
    const scaffoldDir = path.dirname(scaffoldModulePath);
    const templateDirCandidate = path.resolve(scaffoldDir, '../../templates/minimal');

    // Create marker files inside the template directory to ensure copy would pick them up if not filtered
    const gitMarker = path.join(templateDirCandidate, '.git', 'MARKER');
    const nodeMarker = path.join(templateDirCandidate, 'node_modules', 'MARKER');

    try {
      await fs.ensureDir(path.dirname(gitMarker));
      await fs.ensureDir(path.dirname(nodeMarker));
      await fs.writeFile(gitMarker, 'git');
      await fs.writeFile(nodeMarker, 'node');

      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'exclude-check';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      });

      const targetGit = path.join(parent, appName, '.git', 'MARKER');
      const targetNode = path.join(parent, appName, 'node_modules', 'MARKER');

      expect(await fs.pathExists(targetGit)).toBe(false);
      expect(await fs.pathExists(targetNode)).toBe(false);
    } finally {
      // clean up markers from template dir
      try {
        await fs.remove(path.join(templateDirCandidate, '.git'));
      } catch (_) {}
      try {
        await fs.remove(path.join(templateDirCandidate, 'node_modules'));
      } catch (_) {}
    }
  });
});
