// Slow query logger for routes-d (#333).
//
// The logger is intentionally tiny and dependency-free: callers wrap
// any async operation, and this helper emits a structured message only
// when the duration crosses the configured threshold.

export interface SlowQueryLogEntry {
  target: string;
  durationMs: number;
  error?: string;
}

export interface SlowQueryLoggerOptions {
  thresholdMs?: number;
  log?: (entry: SlowQueryLogEntry) => void;
  now?: () => number;
}

export async function withSlowQueryLogging<T>(
  target: string,
  task: () => Promise<T>,
  options: SlowQueryLoggerOptions = {},
): Promise<T> {
  const thresholdMs = options.thresholdMs ?? 250;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? Date.now;
  const started = now();

  try {
    const result = await task();
    const durationMs = now() - started;
    if (durationMs >= thresholdMs) {
      log({ target, durationMs });
    }
    return result;
  } catch (err) {
    const durationMs = now() - started;
    if (durationMs >= thresholdMs) {
      log({
        target,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
