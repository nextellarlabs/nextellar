/**
 * Health probes and backoff math for the global NetworkStatus indicator
 * (issue #1502). Kept free of React so the polling loop in
 * `NetworkStatusProvider` and its tests can use them directly.
 */

export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export interface HealthCheckOptions {
  /** Abort the probe from outside (e.g. on unmount). */
  signal?: AbortSignal;
  /** Per-probe timeout. Defaults to {@link HEALTH_CHECK_TIMEOUT_MS}. */
  timeoutMs?: number;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Runs `fetch` with a timeout, linked to an optional external signal.
 * Always clears its timer so nothing is left running after the probe.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  { signal, timeoutMs = HEALTH_CHECK_TIMEOUT_MS }: HealthCheckOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Horizon is healthy when its root endpoint answers with a 2xx.
 * Never throws: a network error, timeout or abort all mean "not healthy".
 */
export async function checkHorizonHealth(
  horizonUrl: string,
  options: HealthCheckOptions = {},
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${trimTrailingSlash(horizonUrl)}/`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      options,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Soroban RPC is healthy when `getHealth` answers `{ status: "healthy" }`.
 * Never throws: a network error, timeout, abort or malformed body all mean
 * "not healthy".
 */
export async function checkRpcHealth(
  sorobanUrl: string,
  options: HealthCheckOptions = {},
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      trimTrailingSlash(sorobanUrl),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      },
      options,
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: { status?: string } };
    return body?.result?.status === 'healthy';
  } catch {
    return false;
  }
}

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Fraction of the delay randomised either way (0.2 = ±20%). Default 0.2. */
  jitter?: number;
}

/**
 * Exponential backoff for the n-th consecutive failed check (1-based):
 * `baseMs * 2^(failures - 1)`, capped at `maxMs`, then jittered so many
 * tabs/clients don't retry a recovering node in lockstep. The jittered value
 * is never allowed to exceed `maxMs`.
 */
export function computeBackoffDelay(
  failures: number,
  { baseMs, maxMs, jitter = 0.2 }: BackoffOptions,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, failures - 1);
  const capped = Math.min(baseMs * 2 ** exponent, maxMs);
  const spread = capped * jitter * (random() * 2 - 1);
  return Math.min(Math.max(0, Math.round(capped + spread)), maxMs);
}
