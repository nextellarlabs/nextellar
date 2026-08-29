import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Genuine ESM module, so this needs jest.unstable_mockModule rather than
// the classic jest.mock (see tests/scaffold.test.ts for the same note).
// telemetry.ts derives its config path from os.homedir() at import time —
// redirect it to an isolated temp dir so tests never touch the real
// ~/.nextellar/config.json.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// telemetry.ts computes its config path (path.join(os.homedir(), ...)) at
// module-load time, so the mocked homedir must resolve to a real directory
// before the dynamic import below runs — a per-test tmpdir assigned inside
// beforeEach would be undefined at that point. Each test still gets
// isolation by clearing/removing this directory's contents around it.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nextellar-telemetry-'));

jest.unstable_mockModule('os', () => ({
  default: {
    ...os,
    homedir: () => tmpHome,
  },
  homedir: () => tmpHome,
}));

const mockFetch = jest.fn();

const {
  isTelemetryDisabledByEnv,
  readTelemetryConfig,
  setTelemetryEnabled,
  getTelemetryStatus,
  maybeShowTelemetryNotice,
  trackScaffoldEvent,
  flushTelemetry,
  telemetryConfigPath,
} = await import('../src/lib/telemetry');

const baseProperties = {
  template: 'default' as const,
  language: 'typescript' as const,
  network: 'testnet' as const,
  wallets: ['freighter'],
  packageManager: 'npm' as const,
  withContracts: false,
  skipInstall: false,
  success: true,
  cliVersion: '1.0.0',
  nodeVersion: process.versions.node,
  os: process.platform,
};

describe('telemetry (#945)', () => {
  const origEnv = { ...process.env };
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(async () => {
    // Fresh config each test — remove any config.json written by the
    // previous test, but keep tmpHome itself (it's baked into telemetry.ts's
    // module-level CONFIG_PATH, see the comment above the mock).
    await fs.remove(path.join(tmpHome, '.nextellar'));
    process.env = { ...origEnv };
    delete process.env.NEXTELLAR_TELEMETRY_DISABLED;
    delete process.env.NEXTELLAR_TELEMETRY_ENDPOINT;
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(async () => {
    await fs.remove(tmpHome);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
  });

  describe('opt-in default', () => {
    it('is disabled by default until explicitly enabled', async () => {
      expect(await getTelemetryStatus()).toBe('disabled');
    });

    it('does not send an event when telemetry has never been enabled', async () => {
      await trackScaffoldEvent(baseProperties);
      await flushTelemetry();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends an event once explicitly enabled', async () => {
      await setTelemetryEnabled(true);
      await trackScaffoldEvent(baseProperties);
      await flushTelemetry();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('stops sending events after being disabled again', async () => {
      await setTelemetryEnabled(true);
      await setTelemetryEnabled(false);
      await trackScaffoldEvent(baseProperties);
      await flushTelemetry();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('disable controls', () => {
    it('NEXTELLAR_TELEMETRY_DISABLED env var forces telemetry off regardless of config', async () => {
      await setTelemetryEnabled(true);
      process.env.NEXTELLAR_TELEMETRY_DISABLED = 'true';

      expect(isTelemetryDisabledByEnv()).toBe(true);
      expect(await getTelemetryStatus()).toBe('disabled');

      await trackScaffoldEvent(baseProperties);
      await flushTelemetry();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(['1', 'true', 'yes', 'on', 'TRUE', 'On'])(
      'accepts %s as a truthy env override value',
      (value) => {
        process.env.NEXTELLAR_TELEMETRY_DISABLED = value;
        expect(isTelemetryDisabledByEnv()).toBe(true);
      },
    );

    it.each(['0', 'false', 'no', 'off', ''])(
      'does not treat %s as a truthy env override value',
      (value) => {
        process.env.NEXTELLAR_TELEMETRY_DISABLED = value;
        expect(isTelemetryDisabledByEnv()).toBe(false);
      },
    );

    it('the --no-telemetry flag (noTelemetryFlag) suppresses a single invocation', async () => {
      await setTelemetryEnabled(true);
      await trackScaffoldEvent(baseProperties, { noTelemetryFlag: true });
      await flushTelemetry();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('persistent disable via setTelemetryEnabled(false) survives across calls', async () => {
      await setTelemetryEnabled(false);
      const config = await readTelemetryConfig();
      expect(config.telemetry?.enabled).toBe(false);
      expect(await getTelemetryStatus()).toBe('disabled');
    });
  });

  describe('no PII in the collected payload', () => {
    it('sends only the documented, non-identifying properties', async () => {
      await setTelemetryEnabled(true);
      await trackScaffoldEvent(baseProperties);
      await flushTelemetry();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(requestInit.body as string);

      expect(body.event).toBe('scaffold');
      expect(typeof body.anonymousId).toBe('string');
      expect(body.properties).toEqual(baseProperties);

      // No project name, file paths, env vars, or other identifying data
      // anywhere in the payload.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(tmpHome);
      expect(serialized).not.toMatch(/HOME|USER|process\.env/i);
    });

    it('anonymousId is a random identifier, not derived from machine/user info', async () => {
      await setTelemetryEnabled(true);
      const config = await readTelemetryConfig();
      const anonymousId = config.telemetry?.anonymousId;

      expect(anonymousId).toBeTruthy();
      // UUID or 32-char hex fallback — either way, not a username or hostname.
      expect(anonymousId).not.toBe(os.hostname());
      expect(anonymousId?.length).toBeGreaterThanOrEqual(32);
    });

    it('reuses the same anonymousId across multiple events rather than one per event', async () => {
      await setTelemetryEnabled(true);
      await trackScaffoldEvent(baseProperties);
      await trackScaffoldEvent(baseProperties);
      await flushTelemetry();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      const secondBody = JSON.parse(
        (mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(firstBody.anonymousId).toBe(secondBody.anonymousId);
    });
  });

  describe('first-run notice', () => {
    it('shows the transparency notice on first run and records noticeShown', async () => {
      await maybeShowTelemetryNotice();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('anonymous usage data'),
      );
      const config = await readTelemetryConfig();
      expect(config.telemetry?.noticeShown).toBe(true);
      // Notice alone does not opt the user in.
      expect(config.telemetry?.enabled).toBe(false);
    });

    it('does not show the notice again once already shown', async () => {
      await maybeShowTelemetryNotice();
      consoleLogSpy.mockClear();
      await maybeShowTelemetryNotice();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('skips the notice entirely when --no-telemetry is passed', async () => {
      await maybeShowTelemetryNotice({ noTelemetryFlag: true });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('skips the notice entirely when disabled by env', async () => {
      process.env.NEXTELLAR_TELEMETRY_DISABLED = '1';
      await maybeShowTelemetryNotice();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('reliability', () => {
    it('does not throw when the telemetry endpoint is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('network unreachable'));
      await setTelemetryEnabled(true);
      await expect(trackScaffoldEvent(baseProperties)).resolves.toBeUndefined();
      await expect(flushTelemetry()).resolves.toBeUndefined();
    });

    it('config path lives under the home directory as documented', () => {
      expect(telemetryConfigPath).toContain('.nextellar');
      expect(telemetryConfigPath).toContain('config.json');
    });
  });
});
