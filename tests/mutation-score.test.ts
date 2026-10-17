/**
 * Mutation-testing pilot helpers (#1088): scripts/lib/mutation-score.js.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import {
  compareToBaseline,
  computeMutationScore,
  formatScoreTable,
  scoreMutants,
  toBaseline,
} from "../scripts/lib/mutation-score.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const m = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe("scoreMutants", () => {
  it("counts Killed and Timeout as detected, Survived and NoCoverage as not", () => {
    expect(
      scoreMutants(m("Killed", "Timeout", "Survived", "NoCoverage")),
    ).toEqual({ detected: 2, undetected: 2, total: 4, score: 50 });
  });

  it("excludes compile/runtime errors, ignored and pending mutants", () => {
    expect(
      scoreMutants(
        m("Killed", "CompileError", "RuntimeError", "Ignored", "Pending"),
      ),
    ).toEqual({ detected: 1, undetected: 0, total: 1, score: 100 });
  });

  it("returns a null score when nothing is scorable", () => {
    expect(scoreMutants([]).score).toBeNull();
    expect(scoreMutants(m("Ignored")).score).toBeNull();
  });

  it("rounds to two decimals", () => {
    expect(scoreMutants(m("Killed", "Survived", "Survived")).score).toBe(
      33.33,
    );
  });
});

describe("computeMutationScore", () => {
  const report = {
    files: {
      "src\\lib\\b.ts": { mutants: m("Survived", "Killed") },
      "src/lib/a.ts": { mutants: m("Killed", "Killed", "Killed", "Survived") },
      "src/lib/empty.ts": {},
    },
  };

  it("aggregates every file into an overall score", () => {
    const result = computeMutationScore(report);
    expect(result.detected).toBe(4);
    expect(result.total).toBe(6);
    expect(result.score).toBe(66.67);
  });

  it("reports per-file scores with normalised, sorted paths", () => {
    const result = computeMutationScore(report);
    expect(Object.keys(result.files)).toEqual([
      "src/lib/a.ts",
      "src/lib/b.ts",
      "src/lib/empty.ts",
    ]);
    expect(result.files["src/lib/a.ts"].score).toBe(75);
    expect(result.files["src/lib/empty.ts"].score).toBeNull();
  });

  it.each([null, undefined, {}, { schemaVersion: "1" }, "nope"])(
    "rejects a non-report input (%p)",
    (input) => {
      expect(() => computeMutationScore(input as never)).toThrow(
        /Not a Stryker mutation report/,
      );
    },
  );
});

describe("compareToBaseline", () => {
  it("reports no-baseline when none has been recorded yet", () => {
    expect(compareToBaseline({ score: 70 }, null).status).toBe("no-baseline");
    expect(compareToBaseline({ score: 70 }, { score: null }).status).toBe(
      "no-baseline",
    );
  });

  it("flags a drop beyond the tolerance as a regression", () => {
    expect(compareToBaseline({ score: 60 }, { score: 65 })).toEqual({
      status: "regressed",
      delta: -5,
    });
  });

  it("treats small movement within tolerance as unchanged", () => {
    expect(compareToBaseline({ score: 64.5 }, { score: 65 }).status).toBe(
      "unchanged",
    );
  });

  it("reports improvements", () => {
    expect(compareToBaseline({ score: 70 }, { score: 65 }, 1).status).toBe(
      "improved",
    );
  });

  it("does not compare when the run produced no scorable mutants", () => {
    expect(compareToBaseline({ score: null }, { score: 65 }).status).toBe(
      "no-mutants",
    );
  });
});

describe("toBaseline / formatScoreTable", () => {
  const result = computeMutationScore({
    files: { "src/lib/a.ts": { mutants: m("Killed", "Survived") } },
  });

  it("records the overall and per-file score with a timestamp", () => {
    expect(toBaseline(result, "2026-01-01T00:00:00.000Z")).toEqual({
      tool: "stryker",
      scope: "src/lib/**/*.ts",
      recordedAt: "2026-01-01T00:00:00.000Z",
      score: 50,
      detected: 1,
      undetected: 1,
      files: { "src/lib/a.ts": 50 },
    });
  });

  it("renders a table with a total row", () => {
    const table = formatScoreTable(result);
    expect(table).toContain("src/lib/a.ts | 50.00% | 1/2");
    expect(table).toContain("**total** | **50.00%** | 1/2");
  });
});

describe("pilot configuration", () => {
  it("scopes Stryker to src/lib and never breaks the build", async () => {
    // Read as text: jest's moduleFileExtensions does not include .mjs.
    const config = await fs.readFile(
      path.join(ROOT, "stryker.config.mjs"),
      "utf8",
    );
    expect(config).toContain('testRunner: "jest"');
    expect(config).toContain('mutate: ["src/lib/**/*.ts"');
    expect(config).toMatch(/break:\s*null/);
    expect(config).toContain('"reports/mutation/mutation.json"');
  });

  it("ships a baseline file in the shape the CLI writes", async () => {
    const baseline = await fs.readJson(
      path.join(ROOT, "docs", "mutation-baseline.json"),
    );
    expect(baseline).toMatchObject({ tool: "stryker", scope: "src/lib/**/*.ts" });
    expect(baseline).toHaveProperty("score");
    expect(baseline).toHaveProperty("files");
  });
});
