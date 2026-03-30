import fs from 'fs-extra';
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
    expect(kitFile).toContain('const INJECTED_WALLETS: string[] = ["freighter","albedo","lobstr"]');
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
    expect(kitFile).toContain('const INJECTED_WALLETS: string[] = ["freighter","xbull"]');
  });

  test('throws when target directory already exists', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'already-exists-app';
    const target = path.join(parent, appName);
    await fs.ensureDir(target);

    await expect(
      scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      })
    ).rejects.toThrow(/already exists/i);
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
