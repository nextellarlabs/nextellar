import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

// Genuine ESM module under this repo's Jest config (extensionsToTreatAsEsm),
// so mocking execa needs jest.unstable_mockModule — classic jest.mock relies
// on babel's hoist-to-require transform, which doesn't apply once Jest is
// actually running the file as ESM (--experimental-vm-modules).
const mockExeca = jest.fn();
jest.unstable_mockModule('execa', () => ({ execa: mockExeca }));

const { detectPackageManager, getInstallCommand, runInstall, networkErrorHint } = await import(
  '../src/lib/install.js'
);

describe('install utilities', () => {
  beforeEach(() => {
    delete process.env.npm_config_user_agent;
  });

  describe('detectPackageManager', () => {
    it('returns explicit package manager when provided', () => {
      expect(detectPackageManager('/test', 'yarn')).toBe('yarn');
      expect(detectPackageManager('/test', 'pnpm')).toBe('pnpm');
    });

    it('detects from npm_config_user_agent', () => {
      process.env.npm_config_user_agent = 'yarn/1.22.0';
      expect(detectPackageManager('/test')).toBe('yarn');

      process.env.npm_config_user_agent = 'pnpm/6.0.0';
      expect(detectPackageManager('/test')).toBe('pnpm');
    });

    it('defaults to npm when no lockfiles exist', () => {
      expect(detectPackageManager('/nonexistent-path')).toBe('npm');
    });
  });

  describe('getInstallCommand', () => {
    it('returns correct commands for each package manager', () => {
      expect(getInstallCommand('npm')).toEqual(['npm', ['install', '--no-audit', '--no-fund']]);
      expect(getInstallCommand('yarn')).toEqual(['yarn', ['install', '--non-interactive']]);
      expect(getInstallCommand('pnpm')).toEqual(['pnpm', ['install', '--no-frozen-lockfile']]);
    });
  });

  describe('runInstall', () => {
    let tmpDir: string | undefined;

    beforeEach(() => {
      mockExeca.mockReset();
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.remove(tmpDir);
        tmpDir = undefined;
      }
    });

    it('skips installation when skipInstall is true', async () => {
      const result = await runInstall({ cwd: '/test', skipInstall: true });
      expect(result).toEqual({ success: true, packageManager: 'skipped' });
    });

    it('returns success: false with the raw error message when the install command fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('some install error'));
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-install-test-'));

      const result = await runInstall({
        cwd: tmpDir,
        packageManager: 'npm',
      });

      expect(result.success).toBe(false);
      expect(result.packageManager).toBe('npm');
      expect(result.error).toBe('some install error');
    });
  });

  // #673 — targeted hints for common network/registry failure signatures,
  // so the user isn't left decoding a raw stack trace.
  describe('networkErrorHint', () => {
    it('returns undefined when there is no error message', () => {
      expect(networkErrorHint(undefined)).toBeUndefined();
    });

    it('returns undefined for an error unrelated to networking', () => {
      expect(networkErrorHint('EACCES: permission denied, open package.json')).toBeUndefined();
    });

    it.each([
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND registry.npmjs.org'],
      ['ETIMEDOUT', 'connect ETIMEDOUT 104.16.0.35:443'],
      ['EAI_AGAIN', 'getaddrinfo EAI_AGAIN registry.npmjs.org'],
      ['403 Forbidden', 'npm ERR! 403 Forbidden - GET https://registry.npmjs.org/some-package'],
      ['proxy', 'Error: connect ECONNREFUSED behind corporate proxy'],
    ])('recognizes a %s error and returns a hint', (_label, message) => {
      expect(networkErrorHint(message)).toBeDefined();
      expect(typeof networkErrorHint(message)).toBe('string');
    });
  });
});