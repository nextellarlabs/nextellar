import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { isNewerVersion } from '../src/lib/updateNotifier.js';

describe('isNewerVersion (pure)', () => {
  it('detects a newer patch version', () => {
    expect(isNewerVersion('1.1.0', '1.1.1')).toBe(true);
  });

  it('detects a newer minor version', () => {
    expect(isNewerVersion('1.1.0', '1.2.0')).toBe(true);
  });

  it('detects a newer major version', () => {
    expect(isNewerVersion('1.1.0', '2.0.0')).toBe(true);
  });

  it('returns false for an equal version', () => {
    expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false);
  });

  it('returns false for an older version', () => {
    expect(isNewerVersion('1.2.0', '1.1.0')).toBe(false);
  });

  it('handles differing segment counts', () => {
    expect(isNewerVersion('1.1', '1.1.1')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.1')).toBe(false);
  });
});

describe('maybeNotifyUpdate', () => {
  let tmpHome: string;
  let originalOverride: string | undefined;
  let originalFetch: typeof fetch;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetModules();
    originalOverride = process.env.NEXTELLAR_HOME_OVERRIDE;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-update-notifier-test-'));
    process.env.NEXTELLAR_HOME_OVERRIDE = tmpHome;
    originalFetch = global.fetch;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (originalOverride === undefined) {
      delete process.env.NEXTELLAR_HOME_OVERRIDE;
    } else {
      process.env.NEXTELLAR_HOME_OVERRIDE = originalOverride;
    }
    global.fetch = originalFetch;
    logSpy.mockRestore();
    await fs.remove(tmpHome);
  });

  it('does nothing when --no-telemetry was passed', async () => {
    global.fetch = jest.fn() as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0', noTelemetryFlag: true });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does nothing when NEXTELLAR_TELEMETRY_DISABLED is set', async () => {
    process.env.NEXTELLAR_TELEMETRY_DISABLED = '1';
    global.fetch = jest.fn() as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0' });

    expect(global.fetch).not.toHaveBeenCalled();
    delete process.env.NEXTELLAR_TELEMETRY_DISABLED;
  });

  it('fails silently when fetch rejects (offline)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await expect(
      maybeNotifyUpdate({ currentVersion: '1.0.0' }),
    ).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('fails silently when the registry responds non-OK', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0' });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('prints a notice when a newer version is available', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '9.9.9' }),
    }) as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0' });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('1.0.0');
    expect(output).toContain('9.9.9');
  });

  it('prints nothing when already up to date', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    }) as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0' });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('caches the result and does not re-fetch within the check interval', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    });
    global.fetch = fetchMock as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0' });
    await maybeNotifyUpdate({ currentVersion: '1.0.0' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes the cache file so a fresh process reuses it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '9.9.9' }),
    }) as any;
    const { maybeNotifyUpdate } = await import('../src/lib/updateNotifier.js');

    await maybeNotifyUpdate({ currentVersion: '1.0.0' });

    const cachePath = path.join(tmpHome, '.nextellar', 'update-check.json');
    expect(await fs.pathExists(cachePath)).toBe(true);
    const cached = await fs.readJson(cachePath);
    expect(cached.latestKnownVersion).toBe('9.9.9');
  });
});
