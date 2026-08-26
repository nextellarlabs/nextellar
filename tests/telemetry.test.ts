import fs from 'fs-extra';
import path from 'path';
import { tmpdir } from 'node:os';

type TelemetryModule = typeof import('../src/lib/telemetry.ts');

const createTempHome = async (): Promise<string> => {
  return await fs.mkdtemp(path.join(tmpdir(), 'nextellar-telemetry-test-'));
};

const loadTelemetry = async (homeDir: string): Promise<TelemetryModule> => {
  await jest.unstable_mockModule('os', () => ({
    default: {
      homedir: () => homeDir,
    },
  }));

  return await import('../src/lib/telemetry.ts');
};

describe('telemetry', () => {
  let tempHome: string;
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    jest.resetModules();
    tempHome = await createTempHome();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    await fs.remove(tempHome);
    jest.restoreAllMocks();
  });

  it('persists disabled telemetry and reports disabled status', async () => {
    const telemetry = await loadTelemetry(tempHome);
    await telemetry.setTelemetryEnabled(false);

    expect(await telemetry.getTelemetryStatus()).toBe('disabled');

    const config = await fs.readJson(telemetry.telemetryConfigPath);
    expect(config.telemetry?.enabled).toBe(false);
  });

  it('forces disabled telemetry when NEXTELLAR_TELEMETRY_DISABLED is set', async () => {
    process.env.NEXTELLAR_TELEMETRY_DISABLED = 'true';
    const telemetry = await loadTelemetry(tempHome);

    await telemetry.setTelemetryEnabled(true);
    expect(await telemetry.getTelemetryStatus()).toBe('disabled');

    const fetchSpy = jest.fn(() => Promise.resolve({ status: 200 } as any));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await telemetry.trackScaffoldEvent({
      template: 'example',
      language: 'typescript',
      network: 'testnet',
      wallets: ['dev-wallet'],
      packageManager: 'npm',
      withContracts: false,
      skipInstall: false,
      success: true,
      cliVersion: '1.0.0',
      nodeVersion: '20.0.0',
      os: 'windows',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not send telemetry when configured disabled', async () => {
    const telemetry = await loadTelemetry(tempHome);
    await telemetry.setTelemetryEnabled(false);

    const fetchSpy = jest.fn(() => Promise.resolve({ status: 200 } as any));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await telemetry.trackScaffoldEvent({
      template: 'example',
      language: 'javascript',
      network: 'public',
      wallets: [],
      packageManager: 'pnpm',
      withContracts: true,
      skipInstall: true,
      success: false,
      cliVersion: '1.0.0',
      nodeVersion: '20.0.0',
      os: 'linux',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('honors NEXTELLAR_TELEMETRY_ENDPOINT override', async () => {
    const telemetry = await loadTelemetry(tempHome);
    process.env.NEXTELLAR_TELEMETRY_ENDPOINT = 'https://example.com/telemetry';
    await telemetry.setTelemetryEnabled(true);

    const fetchSpy = jest.fn(() => Promise.resolve({ status: 202 } as any));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await telemetry.trackScaffoldEvent({
      template: 'example',
      language: 'javascript',
      network: 'public',
      wallets: ['wallet-a'],
      packageManager: 'yarn',
      withContracts: false,
      skipInstall: true,
      success: true,
      cliVersion: '1.0.0',
      nodeVersion: '20.0.0',
      os: 'macos',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/telemetry');
  });

  it('flushTelemetry never throws when telemetry network fails', async () => {
    const telemetry = await loadTelemetry(tempHome);
    process.env.NEXTELLAR_TELEMETRY_ENDPOINT = 'https://example.com/telemetry';
    await telemetry.setTelemetryEnabled(true);

    globalThis.fetch = jest.fn(() => Promise.reject(new Error('network failure'))) as unknown as typeof fetch;

    await telemetry.trackScaffoldEvent({
      template: 'example',
      language: 'typescript',
      network: 'testnet',
      wallets: ['wallet-a'],
      packageManager: 'npm',
      withContracts: false,
      skipInstall: false,
      success: true,
      cliVersion: '1.0.0',
      nodeVersion: '20.0.0',
      os: 'windows',
    });

    await expect(telemetry.flushTelemetry()).resolves.toBeUndefined();
  });

  it('flushTelemetry never throws when telemetry request times out', async () => {
    jest.useFakeTimers();
    try {
      const telemetry = await loadTelemetry(tempHome);
      process.env.NEXTELLAR_TELEMETRY_ENDPOINT = 'https://example.com/telemetry';
      await telemetry.setTelemetryEnabled(true);

      globalThis.fetch = jest.fn(
        () => new Promise(() => {
          /* never resolves */
        }) as unknown as Promise<Response>
      ) as unknown as typeof fetch;

      await telemetry.trackScaffoldEvent({
        template: 'timeout-example',
        language: 'typescript',
        network: 'testnet',
        wallets: ['wallet-a'],
        packageManager: 'npm',
        withContracts: false,
        skipInstall: false,
        success: true,
        cliVersion: '1.0.0',
        nodeVersion: '20.0.0',
        os: 'windows',
      });

      const flushPromise = telemetry.flushTelemetry();
      jest.advanceTimersByTime(3000);
      await flushPromise;
      expect(true).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
