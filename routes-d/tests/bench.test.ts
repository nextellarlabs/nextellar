// Sanity tests for the routes-d benchmark scaffolding (#314).
//
// The benchmarks themselves are run from a dedicated CI job (no Jest
// in front of the actual profiling so it stays cheap). The unit
// tests here only verify the math + IO helpers used by the runners.
// They DO NOT measure latency budgets — that's the bench job's job.

import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CSV_HEADER,
  ensureCsvHeader,
  recordRun,
  summariseLatencies,
} from "./bench/_recorder.js";
import { runPaymentsSubmitProfile } from "./bench/payments-submit-profile.js";
import { runOrdersListProfile } from "./bench/orders-list-profile.js";

const ARTIFACT_DIR = resolve("routes-d/tests/artifacts/bench-test");

async function freshCsvPath(name: string): Promise<string> {
  const path = `${ARTIFACT_DIR}/${name}.csv`;
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true });
  return path;
}

describe("summariseLatencies", () => {
  it("reports p50/p95/p99 in ascending order", () => {
    const stats = summariseLatencies([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stats.count).toBe(10);
    expect(stats.p50).toBeLessThanOrEqual(stats.p95);
    expect(stats.p95).toBeLessThanOrEqual(stats.p99);
    expect(stats.max).toBe(10);
  });

  it("returns zeroes for an empty sample set", () => {
    const stats = summariseLatencies([]);
    expect(stats).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("ensureCsvHeader / recordRun", () => {
  it("writes the header on first call and skips on subsequent calls", async () => {
    const path = await freshCsvPath("header");
    await ensureCsvHeader(path);
    await ensureCsvHeader(path);
    const body = await readFile(path, "utf8");
    expect(body.startsWith(CSV_HEADER + "\n")).toBe(true);
    expect(body.split("\n").filter((l) => l.startsWith(CSV_HEADER))).toHaveLength(1);
  });

  it("appends a row per recorded run", async () => {
    const path = await freshCsvPath("rows");
    await ensureCsvHeader(path);
    await recordRun(
      [1, 2, 3, 4, 5],
      { profile: "p", outputPath: path, p99BudgetMs: 1000 },
      "2026-05-31T00:00:00.000Z",
    );
    await recordRun(
      [2, 3, 4],
      { profile: "p", outputPath: path, p99BudgetMs: 1000 },
      "2026-05-31T00:01:00.000Z",
    );
    const body = await readFile(path, "utf8");
    const rows = body.trim().split("\n");
    expect(rows[0]).toBe(CSV_HEADER);
    expect(rows).toHaveLength(3);
  });

  it("throws when p99 exceeds the configured budget", async () => {
    const path = await freshCsvPath("regress");
    await expect(
      recordRun(
        [1, 1, 1, 1, 999],
        { profile: "p", outputPath: path, p99BudgetMs: 10 },
        "2026-05-31T00:00:00.000Z",
      ),
    ).rejects.toThrow(/regression/);
  });
});

describe("payments-submit-profile (unit-mode, no CSV)", () => {
  it("produces stats and does not write the CSV without recordedAt", async () => {
    const result = await runPaymentsSubmitProfile({ payments: 25 });
    expect(result.count).toBe(25);
    expect(result.csvPath).toBeUndefined();
  });
});

describe("orders-list-profile (unit-mode, no CSV)", () => {
  it("produces stats and does not write the CSV without recordedAt", async () => {
    const result = await runOrdersListProfile({ seed: 50, lookups: 20 });
    expect(result.count).toBe(20);
    expect(result.csvPath).toBeUndefined();
  });
});
