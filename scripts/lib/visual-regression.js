/**
 * Pure helpers for the Storybook visual-regression check (#1083).
 *
 * scripts/visual-regression.mjs does the I/O (serving the static Storybook
 * build, driving Playwright, reading/writing PNGs); everything that decides
 * *what* is captured and *whether* it passed lives here so it can be unit
 * tested without a browser (tests/visual-regression.test.ts).
 */

/** Default pass threshold: at most 0.1% of pixels may differ. */
export const DEFAULT_MAX_DIFF_RATIO = 0.001;

/**
 * Per-channel tolerance (0-255) below which a pixel is considered unchanged.
 * Absorbs anti-aliasing noise without hiding real colour changes.
 */
export const DEFAULT_CHANNEL_TOLERANCE = 16;

/**
 * Picks the stories to capture from Storybook's `index.json`
 * (Storybook 7+: `{ v, entries: { [id]: { id, title, name, importPath, type } } }`).
 * Docs entries are skipped; `includePrefix` limits capture to one folder
 * (by default the template's components).
 *
 * @param {{ entries?: Record<string, { id: string, title: string, name: string, importPath?: string, type?: string, tags?: string[] }> }} index
 * @param {{ includePrefix?: string, skipTag?: string }} [options]
 */
export function selectStories(index, options = {}) {
  const { includePrefix = "./src/components/", skipTag = "skip-visual" } =
    options;
  if (!index || typeof index !== "object" || !index.entries) {
    throw new Error(
      "Not a Storybook index.json: expected a top-level `entries` object.",
    );
  }
  return Object.values(index.entries)
    .filter((entry) => entry.type === "story")
    .filter(
      (entry) =>
        !includePrefix || (entry.importPath ?? "").startsWith(includePrefix),
    )
    .filter((entry) => !(entry.tags ?? []).includes(skipTag))
    .map((entry) => ({ id: entry.id, title: entry.title, name: entry.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Story ids are already URL-safe; this also guards the file system. */
export function snapshotFileName(storyId) {
  return `${String(storyId).replace(/[^a-z0-9_-]+/gi, "_")}.png`;
}

/** URL of a story's isolated iframe in a static Storybook build. */
export function storyUrl(baseUrl, storyId) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
}

/**
 * Decides the outcome for one story.
 *
 * @param {{ hasBaseline: boolean, sizeMismatch?: boolean, diffPixels?: number, totalPixels?: number }} comparison
 * @param {{ maxDiffRatio?: number }} [options]
 * @returns {{ status: "new" | "pass" | "fail", diffRatio: number | null, reason?: string }}
 */
export function evaluateComparison(comparison, options = {}) {
  const { maxDiffRatio = DEFAULT_MAX_DIFF_RATIO } = options;
  if (!comparison.hasBaseline) {
    return { status: "new", diffRatio: null, reason: "no baseline yet" };
  }
  if (comparison.sizeMismatch) {
    return {
      status: "fail",
      diffRatio: 1,
      reason: "screenshot size differs from baseline",
    };
  }
  const total = comparison.totalPixels ?? 0;
  if (total <= 0) {
    return { status: "fail", diffRatio: 1, reason: "empty screenshot" };
  }
  const diffRatio = (comparison.diffPixels ?? 0) / total;
  return diffRatio > maxDiffRatio
    ? {
        status: "fail",
        diffRatio,
        reason: `${(diffRatio * 100).toFixed(3)}% of pixels differ`,
      }
    : { status: "pass", diffRatio };
}

/**
 * Counts differing pixels between two RGBA buffers of the same size.
 * Shared by the in-browser comparison (stringified into page.evaluate) and
 * the unit tests, so the rule is defined once.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {number} [tolerance]
 */
export function countDiffPixels(a, b, tolerance = DEFAULT_CHANNEL_TOLERANCE) {
  if (a.length !== b.length) {
    throw new Error("Pixel buffers must be the same length.");
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > tolerance ||
      Math.abs(a[i + 1] - b[i + 1]) > tolerance ||
      Math.abs(a[i + 2] - b[i + 2]) > tolerance ||
      Math.abs(a[i + 3] - b[i + 3]) > tolerance
    ) {
      diff++;
    }
  }
  return diff;
}

/**
 * Aggregates per-story results. `ok` is false only for real failures: new
 * stories without a baseline are reported but do not fail the run unless
 * `failOnMissing` is set.
 *
 * @param {{ id: string, status: "new" | "pass" | "fail", reason?: string }[]} results
 * @param {{ failOnMissing?: boolean }} [options]
 */
export function summarizeResults(results, options = {}) {
  const counts = { pass: 0, fail: 0, new: 0 };
  for (const r of results) counts[r.status]++;
  const ok = counts.fail === 0 && (!options.failOnMissing || counts.new === 0);
  return { ...counts, total: results.length, ok };
}

/** Markdown summary for $GITHUB_STEP_SUMMARY. */
export function formatSummaryMarkdown(results, summary) {
  const lines = [
    "## Visual regression (default template Storybook)",
    "",
    `${summary.pass} passed, ${summary.fail} failed, ${summary.new} new (no baseline) of ${summary.total} stories.`,
  ];
  const notable = results.filter((r) => r.status !== "pass");
  if (notable.length > 0) {
    lines.push("", "| story | status | detail |", "| --- | --- | --- |");
    for (const r of notable) {
      lines.push(`| \`${r.id}\` | ${r.status} | ${r.reason ?? ""} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
