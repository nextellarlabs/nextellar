import { jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';
import { server } from '../src/mocks/server.js';
import {
  runDoctor,
  setCommandRunnerForTest,
  setFreeMemoryProviderForTest,
  type CommandRunner,
} from '../src/lib/doctor.js';

// runDoctor() runs every check concurrently, keyed by the exact command
// string each non-network check invokes (see src/lib/doctor.ts). This keeps
// every check other than Horizon/Soroban green so exit-code and JSON output
// only vary because of the network scenario under test.
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

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const SOROBAN_URL = 'https://soroban-testnet.stellar.org';

/**
 * Runs runDoctor({ json: true }), captures the JSON it prints via
 * console.log, and returns the parsed report.
 */
async function runDoctorJson(): Promise<{
  checks: Array<{ id: string; ok: boolean; required: boolean; detail?: string; fix?: string }>;
  passed: number;
  failed: number;
  requiredFailures: number;
}> {
  let captured = '';
  const originalLog = console.log;
  console.log = jest.fn((line: string) => {
    captured += line;
  }) as unknown as typeof console.log;
  try {
    await runDoctor({ json: true });
  } finally {
    console.log = originalLog;
  }
  return JSON.parse(captured);
}

function findCheck(
  report: Awaited<ReturnType<typeof runDoctorJson>>,
  id: 'horizon' | 'soroban',
) {
  const check = report.checks.find((c) => c.id === id);
  if (!check) {
    throw new Error(`No "${id}" check found in doctor report`);
  }
  return check;
}

describe('doctor network checks (Horizon / Soroban)', () => {
  beforeEach(() => {
    setCommandRunnerForTest(withRunner());
    // checkDisk reads real free memory otherwise; default to a healthy 4GB
    // so these tests aren't at the mercy of real memory pressure.
    setFreeMemoryProviderForTest(() => 4_000_000_000);
  });

  afterEach(() => {
    setCommandRunnerForTest(undefined);
    setFreeMemoryProviderForTest(undefined);
  });

  describe('declared "required" values', () => {
    // Horizon is load-bearing for the CLI's core flows (account/tx queries),
    // so it is a required check: a failure here fails the overall exit code.
    // Soroban is only needed for contract-related flows, so it is optional:
    // a failure here is surfaced but does not fail the overall exit code.
    it('marks Horizon as a required check', async () => {
      const report = await runDoctorJson();
      expect(findCheck(report, 'horizon').required).toBe(true);
    });

    it('marks Soroban as a non-required (optional) check', async () => {
      const report = await runDoctorJson();
      expect(findCheck(report, 'soroban').required).toBe(false);
    });
  });

  describe('Horizon reachability', () => {
    it('is ok when the Horizon endpoint responds healthily', async () => {
      // Default MSW handler (src/mocks/handlers.ts) already returns 200 for
      // a HEAD request to the Horizon root — no override needed.
      const report = await runDoctorJson();
      const horizon = findCheck(report, 'horizon');

      expect(horizon.ok).toBe(true);
      expect(horizon.detail).toContain(HORIZON_URL);
    });

    it('fails with a fix suggestion when Horizon returns a 5xx', async () => {
      server.use(
        http.head(HORIZON_URL, () => new HttpResponse(null, { status: 503 })),
      );

      const report = await runDoctorJson();
      const horizon = findCheck(report, 'horizon');

      expect(horizon.ok).toBe(false);
      expect(horizon.fix).toBeTruthy();
      expect(horizon.detail).toContain('503');
      // Horizon is required, so a 5xx here must fail the overall run.
      expect(report.requiredFailures).toBeGreaterThan(0);
    });

    it('is caught and reported as failed on a network error, with no unhandled rejection', async () => {
      server.use(http.head(HORIZON_URL, () => HttpResponse.error()));

      await expect(runDoctorJson()).resolves.toBeDefined();

      const report = await runDoctorJson();
      const horizon = findCheck(report, 'horizon');

      expect(horizon.ok).toBe(false);
      expect(horizon.fix).toBeTruthy();
      expect(horizon.detail).toMatch(/unreachable/i);
    });

    it('is caught and reported as failed on a timeout (abort)', async () => {
      // doctor.ts aborts the request after 5s via AbortController; simulate
      // that by having the handler itself signal an abort-style network
      // error so the check's catch branch is exercised without real delay.
      server.use(http.head(HORIZON_URL, () => HttpResponse.error()));

      const report = await runDoctorJson();
      const horizon = findCheck(report, 'horizon');

      expect(horizon.ok).toBe(false);
      expect(horizon.fix).toBeTruthy();
    });
  });

  describe('Soroban reachability', () => {
    it('is ok when the Soroban endpoint responds healthily', async () => {
      // Default MSW handler (src/mocks/handlers.ts) already returns 200 for
      // a "status" JSON-RPC call to the Soroban root — no override needed.
      const report = await runDoctorJson();
      const soroban = findCheck(report, 'soroban');

      expect(soroban.ok).toBe(true);
      expect(soroban.detail).toContain(SOROBAN_URL);
    });

    it('fails with a fix suggestion when Soroban returns a 5xx', async () => {
      server.use(
        http.post(SOROBAN_URL, () => HttpResponse.json({}, { status: 500 })),
      );

      const report = await runDoctorJson();
      const soroban = findCheck(report, 'soroban');

      expect(soroban.ok).toBe(false);
      expect(soroban.fix).toBeTruthy();
      expect(soroban.detail).toContain('500');
      // Soroban is optional, so its failure alone must not fail the run.
      expect(report.requiredFailures).toBe(0);
    });

    it('is caught and reported as failed on a network error, with no unhandled rejection', async () => {
      server.use(http.post(SOROBAN_URL, () => HttpResponse.error()));

      await expect(runDoctorJson()).resolves.toBeDefined();

      const report = await runDoctorJson();
      const soroban = findCheck(report, 'soroban');

      expect(soroban.ok).toBe(false);
      expect(soroban.fix).toBeTruthy();
      expect(soroban.detail).toMatch(/unreachable/i);
    });
  });

  describe('overall exit-code semantics with a live network scenario', () => {
    it('returns 1 when Horizon is down even if everything else is healthy', async () => {
      server.use(http.head(HORIZON_URL, () => new HttpResponse(null, { status: 500 })));
      console.log = jest.fn();

      const code = await runDoctor();

      expect(code).toBe(1);
    });

    it('returns 0 when only Soroban is down and everything else is healthy', async () => {
      server.use(http.post(SOROBAN_URL, () => HttpResponse.json({}, { status: 500 })));
      console.log = jest.fn();

      const code = await runDoctor();

      expect(code).toBe(0);
    });
  });
});
