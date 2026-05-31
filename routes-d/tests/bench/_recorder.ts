// Shared latency recorder used by every routes-d/tests/bench profile
// (#314).
//
// Records per-sample latencies, computes p50 / p99, appends a row to
// a CSV ledger, and throws when the measured p99 regresses above the
// per-profile budget. Pure helper — no Express, no jest, no global
// state.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const benchCsvPath = resolve("routes-d/tests/artifacts/bench.csv");

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summariseLatencies(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx] ?? 0;
  };
  return {
    count: samples.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export interface RecorderOptions {
  /** Profile name written to the CSV `profile` column. */
  profile: string;
  /** Override the CSV output path (defaults to `benchCsvPath`). */
  outputPath?: string;
  /** Fail the run if p99 exceeds this many ms. Default 250. */
  p99BudgetMs?: number;
  /** Fail the run if any single sample exceeds this many ms. Default 1000. */
  maxBudgetMs?: number;
}

export interface RecordedRun extends LatencyStats {
  profile: string;
  /** ISO timestamp captured by the caller (passed in for determinism). */
  recordedAt: string;
  /** True when p99/max stayed within the configured budgets. */
  withinBudget: boolean;
  csvPath: string;
}

/** Append a CSV row + raise on regression. The caller passes the
 *  timestamp so tests can pin a deterministic value. */
export async function recordRun(
  samples: number[],
  options: RecorderOptions,
  recordedAt: string,
): Promise<RecordedRun> {
  const stats = summariseLatencies(samples);
  const p99Budget = options.p99BudgetMs ?? 250;
  const maxBudget = options.maxBudgetMs ?? 1000;
  const csvPath = options.outputPath ?? benchCsvPath;

  await mkdir(dirname(csvPath), { recursive: true });
  // Header row is written by `ensureCsvHeader` from the runner; this
  // function only appends data rows so it remains idempotent.
  const row = [
    recordedAt,
    options.profile,
    String(stats.count),
    stats.p50.toFixed(2),
    stats.p95.toFixed(2),
    stats.p99.toFixed(2),
    stats.max.toFixed(2),
  ].join(",");
  await appendFile(csvPath, row + "\n");

  const withinBudget = stats.p99 <= p99Budget && stats.max <= maxBudget;
  if (!withinBudget) {
    throw new Error(
      `${options.profile}: p99 ${stats.p99.toFixed(2)}ms > ${p99Budget}ms ` +
        `or max ${stats.max.toFixed(2)}ms > ${maxBudget}ms — regression`,
    );
  }

  return { ...stats, profile: options.profile, recordedAt, withinBudget, csvPath };
}

export const CSV_HEADER = "recorded_at,profile,count,p50_ms,p95_ms,p99_ms,max_ms";

/** Write the CSV header if the file doesn't yet exist. Callers can
 *  invoke this once at the start of a benchmark CI step. */
export async function ensureCsvHeader(path: string = benchCsvPath): Promise<void> {
  const { access, writeFile } = await import("node:fs/promises");
  try {
    await access(path);
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, CSV_HEADER + "\n");
  }
}
