/**
 * Pure helpers for the Stryker mutation-testing pilot (#1088).
 *
 * Kept free of I/O so tests/mutation-score.test.ts can exercise them
 * directly; scripts/mutation-score.mjs is the thin CLI wrapper that reads
 * Stryker's JSON report and the committed baseline.
 *
 * Input is Stryker's `mutation-testing-report-schema` JSON
 * (reports/mutation/mutation.json): `{ files: { [path]: { mutants: [{ status }] } } }`.
 */

/** Statuses that count as "detected" (the test suite noticed the mutant). */
export const DETECTED_STATUSES = new Set(["Killed", "Timeout"]);

/** Statuses that count as "undetected" (an assertion-quality gap). */
export const UNDETECTED_STATUSES = new Set(["Survived", "NoCoverage"]);

// CompileError, RuntimeError, Ignored and Pending are excluded from the
// score, matching Stryker's own "mutation score" definition.

/**
 * @param {{ status: string }[]} mutants
 * @returns {{ detected: number, undetected: number, total: number, score: number | null }}
 */
export function scoreMutants(mutants) {
  let detected = 0;
  let undetected = 0;
  for (const mutant of mutants) {
    if (DETECTED_STATUSES.has(mutant.status)) detected++;
    else if (UNDETECTED_STATUSES.has(mutant.status)) undetected++;
  }
  const total = detected + undetected;
  return {
    detected,
    undetected,
    total,
    score: total === 0 ? null : round2((detected / total) * 100),
  };
}

/**
 * Computes the overall and per-file mutation score from a Stryker report.
 *
 * @param {{ files?: Record<string, { mutants?: { status: string }[] }> }} report
 */
export function computeMutationScore(report) {
  if (!report || typeof report !== "object" || !report.files) {
    throw new Error(
      "Not a Stryker mutation report: expected a top-level `files` object.",
    );
  }

  const files = {};
  const all = [];
  for (const [file, data] of Object.entries(report.files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const mutants = Array.isArray(data?.mutants) ? data.mutants : [];
    all.push(...mutants);
    files[normalizePath(file)] = scoreMutants(mutants);
  }

  return { ...scoreMutants(all), files };
}

/**
 * Compares a fresh result to the committed baseline. A drop larger than
 * `tolerance` percentage points counts as a regression. A baseline with no
 * recorded score (`score: null`) never regresses: the pilot simply has
 * nothing to compare against yet.
 *
 * @param {{ score: number | null }} current
 * @param {{ score: number | null } | null | undefined} baseline
 * @param {number} [tolerance]
 */
export function compareToBaseline(current, baseline, tolerance = 1) {
  if (!baseline || baseline.score === null || baseline.score === undefined) {
    return { status: "no-baseline", delta: null };
  }
  if (current.score === null) {
    return { status: "no-mutants", delta: null };
  }
  const delta = round2(current.score - baseline.score);
  if (delta < -tolerance) return { status: "regressed", delta };
  if (delta > tolerance) return { status: "improved", delta };
  return { status: "unchanged", delta };
}

/**
 * Builds the JSON written to docs/mutation-baseline.json.
 *
 * @param {ReturnType<typeof computeMutationScore>} result
 * @param {string} recordedAt ISO timestamp
 */
export function toBaseline(result, recordedAt) {
  const files = {};
  for (const [file, s] of Object.entries(result.files)) {
    files[file] = s.score;
  }
  return {
    tool: "stryker",
    scope: "src/lib/**/*.ts",
    recordedAt,
    score: result.score,
    detected: result.detected,
    undetected: result.undetected,
    files,
  };
}

/** Renders a plain-text table for the terminal / CI step summary. */
export function formatScoreTable(result) {
  const lines = ["file | score | detected/total", "--- | ---: | ---:"];
  for (const [file, s] of Object.entries(result.files)) {
    lines.push(`${file} | ${fmt(s.score)} | ${s.detected}/${s.total}`);
  }
  lines.push(
    `**total** | **${fmt(result.score)}** | ${result.detected}/${result.total}`,
  );
  return lines.join("\n");
}

function fmt(score) {
  return score === null ? "n/a" : `${score.toFixed(2)}%`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalizePath(p) {
  return p.split("\\").join("/");
}
