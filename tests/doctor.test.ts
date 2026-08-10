import { jest } from '@jest/globals';
import {
  runDoctor,
  setCommandRunnerForTest,
  setFreeMemoryProviderForTest,
  type CommandRunner,
} from '../src/lib/doctor.js';

// Every check runDoctor() runs concurrently, keyed by the exact command
// string each check invokes (see src/lib/doctor.ts). Defaults simulate a
// fully healthy toolchain; individual tests override just the command(s)
// they care about via `withRunner`.
const HEALTHY: Record<string, { ok: boolean; out: string }> = {
  'node --version': { ok: true, out: 'v20.10.0' },
  'npm --version': { ok: true, out: '10.2.3' },
  'yarn --version': { ok: true, out: '1.22.19' },
  'pnpm --version': { ok: true, out: '8.10.0' },
  'git --version': { ok: true, out: 'git version 2.42.0' },
  'rustc --version': { ok: true, out: 'rustc 1.73.0' },
  'stellar --version': { ok: true, out: 'stellar-cli 20.0.0' },
  'rustup target list --installed': { ok: true, out: 'wasm32-unknown-unknown\nx86_64-apple-darwin' },
};

function withRunner(overrides: Record<string, { ok: boolean; out: string }> = {}): CommandRunner {
  const table = { ...HEALTHY, ...overrides };
  return async (cmd: string) => table[cmd] ?? { ok: false, out: 'command not found' };
}

describe('doctor', () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;

  beforeEach(() => {
    // checkHorizon/checkSoroban use fetch directly; mocking their specific
    // behavior is out of scope here (split into a separate testing issue —
    // see doctor.ts's checkHorizon/checkSoroban), but a real network call
    // must never happen during this test run regardless, so this stub
    // always resolves ok.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    // checkDisk reads real free memory otherwise, which makes it depend on
    // whatever else is running on the test machine — default to a healthy
    // 4GB so exit-code tests aren't at the mercy of real memory pressure.
    setFreeMemoryProviderForTest(() => 4_000_000_000);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    console.log = originalLog;
    setCommandRunnerForTest(undefined);
    setFreeMemoryProviderForTest(undefined);
  });

  describe('exit-code semantics', () => {
    it('returns 0 when every required check passes, even if an optional check fails', async () => {
      setCommandRunnerForTest(withRunner({ 'yarn --version': { ok: false, out: 'not found' } }));
      console.log = jest.fn();

      const code = await runDoctor();

      expect(code).toBe(0);
    });

    it('returns 1 when a required check fails', async () => {
      setCommandRunnerForTest(withRunner({ 'git --version': { ok: false, out: 'not found' } }));
      console.log = jest.fn();

      const code = await runDoctor();

      expect(code).toBe(1);
    });

    it('returns 1 when multiple required checks fail', async () => {
      setCommandRunnerForTest(
        withRunner({
          'git --version': { ok: false, out: 'not found' },
          'npm --version': { ok: false, out: 'not found' },
        }),
      );
      console.log = jest.fn();

      const code = await runDoctor();

      expect(code).toBe(1);
    });

    it('returns 0 when only optional checks fail (rust toolchain entirely absent)', async () => {
      setCommandRunnerForTest(
        withRunner({
          'rustc --version': { ok: false, out: 'not found' },
          'stellar --version': { ok: false, out: 'not found' },
          'rustup target list --installed': { ok: false, out: 'not found' },
          'yarn --version': { ok: false, out: 'not found' },
          'pnpm --version': { ok: false, out: 'not found' },
        }),
      );
      console.log = jest.fn();

      const code = await runDoctor();

      expect(code).toBe(0);
    });
  });

  describe('Node.js version gating', () => {
    it('passes when node --version reports >= 20', async () => {
      setCommandRunnerForTest(withRunner({ 'node --version': { ok: true, out: 'v20.0.0' } }));
      let captured = '';
      console.log = jest.fn((line: string) => {
        captured += line;
      });

      await runDoctor({ json: true });

      const parsed = JSON.parse(captured);
      const nodeCheck = parsed.checks.find((c: { id: string }) => c.id === 'node');
      expect(nodeCheck.ok).toBe(true);
    });

    it('passes for a node major version well above 20', async () => {
      setCommandRunnerForTest(withRunner({ 'node --version': { ok: true, out: 'v22.4.1' } }));
      let captured = '';
      console.log = jest.fn((line: string) => {
        captured += line;
      });

      await runDoctor({ json: true });

      const parsed = JSON.parse(captured);
      expect(parsed.checks.find((c: { id: string }) => c.id === 'node').ok).toBe(true);
    });

    it('fails when node --version reports < 20', async () => {
      setCommandRunnerForTest(withRunner({ 'node --version': { ok: true, out: 'v18.19.0' } }));
      let captured = '';
      console.log = jest.fn((line: string) => {
        captured += line;
      });

      const code = await runDoctor({ json: true });

      const parsed = JSON.parse(captured);
      const nodeCheck = parsed.checks.find((c: { id: string }) => c.id === 'node');
      expect(nodeCheck.ok).toBe(false);
      // node is a required check, so an overall failing exit code follows.
      expect(code).toBe(1);
    });
  });

  describe('--json output shape', () => {
    it('produces valid JSON containing every check id, ok, and required flag', async () => {
      setCommandRunnerForTest(withRunner());
      let captured = '';
      console.log = jest.fn((line: string) => {
        captured += line;
      });

      await runDoctor({ json: true });

      const parsed = JSON.parse(captured);
      expect(Array.isArray(parsed.checks)).toBe(true);
      expect(parsed.checks.length).toBeGreaterThan(0);
      for (const check of parsed.checks) {
        expect(typeof check.id).toBe('string');
        expect(typeof check.ok).toBe('boolean');
        expect(typeof check.required).toBe('boolean');
      }
      // Every check id doctor.ts defines should be present.
      const ids = parsed.checks.map((c: { id: string }) => c.id).sort();
      expect(ids).toEqual(
        ['disk', 'git', 'horizon', 'node', 'npm', 'pnpm', 'rustc', 'soroban', 'stellar-cli', 'wasm32', 'yarn'].sort(),
      );
    });

    it('includes passed/failed/requiredFailures summary counts', async () => {
      setCommandRunnerForTest(withRunner({ 'git --version': { ok: false, out: 'not found' } }));
      let captured = '';
      console.log = jest.fn((line: string) => {
        captured += line;
      });

      await runDoctor({ json: true });

      const parsed = JSON.parse(captured);
      expect(parsed.requiredFailures).toBeGreaterThanOrEqual(1);
      expect(parsed.passed + parsed.failed).toBe(parsed.checks.length);
    });
  });

  describe('no real subprocesses or network calls', () => {
    it('never invokes the real command runner once overridden', async () => {
      const spy = jest.fn(withRunner());
      setCommandRunnerForTest(spy);
      console.log = jest.fn();

      await runDoctor();

      expect(spy).toHaveBeenCalled();
      // Every call went through the mock; if the real subprocess runner had
      // been used instead, `node --version` etc. would still happen to
      // succeed locally, so the meaningful assertion is that our injected
      // spy is what actually got called for each known command.
      const calledCommands = spy.mock.calls.map((args) => args[0]);
      expect(calledCommands).toEqual(expect.arrayContaining(['node --version', 'git --version']));
    });

    it('never calls the real fetch implementation', async () => {
      setCommandRunnerForTest(withRunner());
      console.log = jest.fn();

      await runDoctor();

      expect(global.fetch).toHaveBeenCalled();
      expect(jest.isMockFunction(global.fetch)).toBe(true);
    });
  });
});
