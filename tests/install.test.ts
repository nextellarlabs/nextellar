import { detectPackageManager, getInstallCommand, runInstall } from '../src/lib/install.js';

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
    it('skips installation when skipInstall is true', async () => {
      const result = await runInstall({ cwd: '/test', skipInstall: true });
      expect(result).toEqual({ success: true, packageManager: 'skipped' });
    });
  });
});