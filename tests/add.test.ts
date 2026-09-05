import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAdd } from '../src/lib/add.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES = path.resolve(__dirname, '../src/templates');
const templateFile = (template: string, rel: string) =>
  path.join(TEMPLATES, template, 'src', rel);

jest.setTimeout(30000);

describe('runAdd', () => {
  const tmpDirs: string[] = [];
  let logSpy: jest.SpyInstance;

  /** Minimal Next.js project; `template` writes the .nextellar marker. */
  const makeProject = async (template?: string) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-add-'));
    tmpDirs.push(dir);
    await fs.writeJson(path.join(dir, 'package.json'), {
      name: 'demo',
      dependencies: { next: '16.1.2' },
    });
    if (template) {
      await fs.outputJson(path.join(dir, '.nextellar/config.json'), {
        template,
        nextellarVersion: '1.0.0',
      });
    }
    return dir;
  };

  const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  const read = (file: string) => fs.readFile(file, 'utf8');

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
    tmpDirs.length = 0;
  });

  describe('guards', () => {
    it('rejects an unknown feature', async () => {
      const cwd = await makeProject();
      const result = await runAdd('not-a-feature', { cwd, skipInstall: true });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown feature');
    });

    it('rejects a directory without package.json', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-add-'));
      tmpDirs.push(dir);

      const result = await runAdd('wallet', { cwd: dir, skipInstall: true });

      expect(result.success).toBe(false);
      expect(result.message).toContain('No package.json');
    });

    it('skips existing files unless --force is passed', async () => {
      const cwd = await makeProject();
      await runAdd('wallet', { cwd, skipInstall: true });

      const hook = path.join(cwd, 'src/hooks/useStellarWallet.ts');
      await fs.writeFile(hook, '// user edit\n');

      const second = await runAdd('wallet', { cwd, skipInstall: true });
      expect(second.success).toBe(false);
      expect(second.message).toContain('--force');
      expect(await read(hook)).toBe('// user edit\n');

      const forced = await runAdd('wallet', { cwd, skipInstall: true, force: true });
      expect(forced.success).toBe(true);
      expect(await read(hook)).toBe(
        await read(templateFile('default', 'hooks/useStellarWallet.ts'))
      );
    });
  });

  describe('template resolution', () => {
    it('sources files from the project template recorded in .nextellar/config.json', async () => {
      const cwd = await makeProject('defi');

      const result = await runAdd('trustlines', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      const copied = await read(path.join(cwd, 'src/hooks/useTrustlines.ts'));
      expect(copied).toBe(await read(templateFile('defi', 'hooks/useTrustlines.ts')));
      expect(copied).not.toBe(
        await read(templateFile('default', 'hooks/useTrustlines.ts'))
      );
      // Its wallet dependency comes from the defi template too.
      expect(await read(path.join(cwd, 'src/hooks/useStellarWallet.ts'))).toBe(
        await read(templateFile('defi', 'hooks/useStellarWallet.ts'))
      );
      expect(output()).toContain('Source template: defi');
    });

    it('falls back to the default template and says so when a file is missing', async () => {
      const cwd = await makeProject('defi');
      // The defi template ships no Soroban hooks today.
      expect(
        await fs.pathExists(templateFile('defi', 'hooks/useSorobanContract.ts'))
      ).toBe(false);

      const result = await runAdd('contracts', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      expect(await read(path.join(cwd, 'src/hooks/useSorobanContract.ts'))).toBe(
        await read(templateFile('default', 'hooks/useSorobanContract.ts'))
      );

      const logged = output();
      expect(logged).toContain('copied from');
      expect(logged).toContain('hooks/useSorobanContract.ts');
      expect(logged).toContain('hooks/useSorobanEvents.ts');
    });

    it('does not report a fallback for files the project template does ship', async () => {
      const cwd = await makeProject('defi');

      await runAdd('balances', { cwd, skipInstall: true });

      expect(output()).not.toContain('copied from');
    });

    it('uses the default template when .nextellar/config.json is absent', async () => {
      const cwd = await makeProject();

      const result = await runAdd('trustlines', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      expect(await read(path.join(cwd, 'src/hooks/useTrustlines.ts'))).toBe(
        await read(templateFile('default', 'hooks/useTrustlines.ts'))
      );
      expect(output()).toContain('Source template: default');
    });

    it('copies the .js/.jsx variants for a JavaScript project', async () => {
      const cwd = await makeProject('js-template');

      const result = await runAdd('wallet', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      expect(await read(path.join(cwd, 'src/hooks/useStellarWallet.js'))).toBe(
        await read(templateFile('js-template', 'hooks/useStellarWallet.js'))
      );
      expect(
        await fs.pathExists(path.join(cwd, 'src/contexts/WalletProvider.jsx'))
      ).toBe(true);
      // No TypeScript files leak into a JS project.
      expect(
        await fs.pathExists(path.join(cwd, 'src/hooks/useStellarWallet.ts'))
      ).toBe(false);
      expect(output()).not.toContain('copied from');
    });

    it('uses the default template when the configured template is unknown', async () => {
      const cwd = await makeProject('template-from-the-future');

      const result = await runAdd('balances', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      expect(await read(path.join(cwd, 'src/hooks/useStellarBalances.ts'))).toBe(
        await read(templateFile('default', 'hooks/useStellarBalances.ts'))
      );
      expect(output()).toContain('Source template: default');
    });
  });

  describe('components feature', () => {
    it('copies a component together with the hook it renders', async () => {
      const cwd = await makeProject();

      const result = await runAdd('network-switcher', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      expect(
        await fs.pathExists(path.join(cwd, 'src/components/NetworkSwitcher.tsx'))
      ).toBe(true);
      // wallet is its dependency, so the provider/hook land as well.
      expect(
        await fs.pathExists(path.join(cwd, 'src/hooks/useStellarWallet.ts'))
      ).toBe(true);
      expect(
        await fs.pathExists(path.join(cwd, 'src/contexts/WalletProvider.tsx'))
      ).toBe(true);
    });

    it('pulls every component plus its hook dependencies', async () => {
      const cwd = await makeProject();

      const result = await runAdd('components', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      for (const rel of [
        'src/hooks/useStellarWallet.ts',
        'src/hooks/useStellarBalances.ts',
        'src/hooks/useStellarPayment.ts',
        'src/hooks/useTransactionHistory.ts',
        'src/components/WalletConnectButton.tsx',
        'src/components/NetworkSwitcher.tsx',
      ]) {
        expect(await fs.pathExists(path.join(cwd, rel))).toBe(true);
      }
    });

    it('reports components that no template ships yet instead of failing silently', async () => {
      const cwd = await makeProject();

      const result = await runAdd('components', { cwd, skipInstall: true });

      expect(result.success).toBe(true);
      const logged = output();
      for (const rel of [
        'components/BalanceDisplay.tsx',
        'components/SendForm.tsx',
        'components/TransactionList.tsx',
      ]) {
        // Guard: once the component lands in the template this flips to a copy.
        if (!(await fs.pathExists(templateFile('default', rel)))) {
          expect(logged).toContain(rel);
        }
      }
    });

    it('still installs the hook dependency when only the component is unavailable', async () => {
      const cwd = await makeProject();

      const result = await runAdd('send-form', { cwd, skipInstall: true });

      if (await fs.pathExists(templateFile('default', 'components/SendForm.tsx'))) {
        expect(result.success).toBe(true);
      } else {
        // The hook dependency still lands; only the component is unavailable.
        expect(
          await fs.pathExists(path.join(cwd, 'src/hooks/useStellarPayment.ts'))
        ).toBe(true);
        expect(output()).toContain('components/SendForm.tsx');
      }
    });
  });
});
