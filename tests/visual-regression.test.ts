/**
 * Visual regression helpers (#1083): scripts/lib/visual-regression.js.
 * The Playwright run itself happens in CI (see the `visual-regression` job);
 * these tests lock the selection and pass/fail rules it relies on.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_MAX_DIFF_RATIO,
  countDiffPixels,
  evaluateComparison,
  formatSummaryMarkdown,
  selectStories,
  snapshotFileName,
  storyUrl,
  summarizeResults,
} from "../scripts/lib/visual-regression.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const index = {
  v: 5,
  entries: {
    "components-sendform--default": {
      id: "components-sendform--default",
      title: "Components/SendForm",
      name: "Default",
      importPath: "./src/components/SendForm.stories.tsx",
      type: "story",
    },
    "components-sendform--docs": {
      id: "components-sendform--docs",
      title: "Components/SendForm",
      name: "Docs",
      importPath: "./src/components/SendForm.stories.tsx",
      type: "docs",
    },
    "components-copybutton--copied": {
      id: "components-copybutton--copied",
      title: "Components/CopyButton",
      name: "Copied",
      importPath: "./src/components/CopyButton.stories.tsx",
      type: "story",
    },
    "intro--page": {
      id: "intro--page",
      title: "Intro",
      name: "Page",
      importPath: "./src/stories/Intro.stories.tsx",
      type: "story",
    },
    "components-flaky--animated": {
      id: "components-flaky--animated",
      title: "Components/Flaky",
      name: "Animated",
      importPath: "./src/components/Flaky.stories.tsx",
      type: "story",
      tags: ["skip-visual"],
    },
  },
};

describe("selectStories", () => {
  it("keeps component stories only, sorted by id", () => {
    expect(selectStories(index).map((s) => s.id)).toEqual([
      "components-copybutton--copied",
      "components-sendform--default",
    ]);
  });

  it("can widen the scope with includePrefix", () => {
    const ids = selectStories(index, { includePrefix: "./src/" }).map(
      (s) => s.id,
    );
    expect(ids).toContain("intro--page");
    expect(ids).not.toContain("components-sendform--docs");
  });

  it("honours the skip-visual tag", () => {
    expect(selectStories(index).map((s) => s.id)).not.toContain(
      "components-flaky--animated",
    );
  });

  it.each([null, {}, { stories: {} }])(
    "rejects something that is not a Storybook index (%p)",
    (input) => {
      expect(() => selectStories(input as never)).toThrow(
        /Not a Storybook index.json/,
      );
    },
  );
});

describe("snapshotFileName / storyUrl", () => {
  it("maps a story id to a safe png name", () => {
    expect(snapshotFileName("components-sendform--default")).toBe(
      "components-sendform--default.png",
    );
    expect(snapshotFileName("../evil/../id")).toBe("_evil_id.png");
  });

  it("builds the isolated iframe URL", () => {
    expect(storyUrl("http://127.0.0.1:6006", "a--b")).toBe(
      "http://127.0.0.1:6006/iframe.html?id=a--b&viewMode=story",
    );
    expect(storyUrl("http://x/", "a--b")).toBe(
      "http://x/iframe.html?id=a--b&viewMode=story",
    );
  });
});

describe("evaluateComparison", () => {
  it("marks a story without a baseline as new", () => {
    expect(evaluateComparison({ hasBaseline: false }).status).toBe("new");
  });

  it("passes identical screenshots", () => {
    expect(
      evaluateComparison({
        hasBaseline: true,
        diffPixels: 0,
        totalPixels: 1000,
      }),
    ).toEqual({ status: "pass", diffRatio: 0 });
  });

  it("passes at exactly the threshold and fails just above it", () => {
    const total = 100000;
    const atLimit = Math.floor(total * DEFAULT_MAX_DIFF_RATIO);
    expect(
      evaluateComparison({
        hasBaseline: true,
        diffPixels: atLimit,
        totalPixels: total,
      }).status,
    ).toBe("pass");
    expect(
      evaluateComparison({
        hasBaseline: true,
        diffPixels: atLimit + 1,
        totalPixels: total,
      }).status,
    ).toBe("fail");
  });

  it("fails on a size change", () => {
    expect(
      evaluateComparison({ hasBaseline: true, sizeMismatch: true }),
    ).toMatchObject({ status: "fail", reason: expect.stringMatching(/size/) });
  });

  it("fails on an empty capture", () => {
    expect(
      evaluateComparison({ hasBaseline: true, diffPixels: 0, totalPixels: 0 })
        .status,
    ).toBe("fail");
  });

  it("respects a custom maxDiffRatio", () => {
    expect(
      evaluateComparison(
        { hasBaseline: true, diffPixels: 50, totalPixels: 1000 },
        { maxDiffRatio: 0.1 },
      ).status,
    ).toBe("pass");
  });
});

describe("countDiffPixels", () => {
  const px = (...rgba: number[]) => Uint8ClampedArray.from(rgba);

  it("ignores differences within the channel tolerance", () => {
    expect(countDiffPixels(px(0, 0, 0, 255), px(10, 10, 10, 255))).toBe(0);
  });

  it("counts a pixel once even when several channels differ", () => {
    expect(
      countDiffPixels(
        px(0, 0, 0, 255, 255, 255, 255, 255),
        px(200, 200, 0, 255, 255, 255, 255, 255),
      ),
    ).toBe(1);
  });

  it("detects alpha changes", () => {
    expect(countDiffPixels(px(0, 0, 0, 255), px(0, 0, 0, 0))).toBe(1);
  });

  it("rejects buffers of different sizes", () => {
    expect(() => countDiffPixels(px(0, 0, 0, 0), px(0, 0, 0))).toThrow(
      /same length/,
    );
  });

  it("is self-contained so it can run inside the browser", () => {
    // scripts/visual-regression.mjs stringifies this function into
    // page.evaluate; it must not close over module scope when called with an
    // explicit tolerance.
    const fn = new Function(`return (${countDiffPixels.toString()})`)();
    expect(fn(px(0, 0, 0, 255), px(255, 0, 0, 255), 16)).toBe(1);
  });
});

describe("summarizeResults / formatSummaryMarkdown", () => {
  const results = [
    { id: "a", status: "pass" as const },
    { id: "b", status: "new" as const, reason: "no baseline yet" },
  ];

  it("does not fail a run on new stories by default", () => {
    expect(summarizeResults(results)).toEqual({
      pass: 1,
      fail: 0,
      new: 1,
      total: 2,
      ok: true,
    });
  });

  it("fails on new stories with failOnMissing", () => {
    expect(summarizeResults(results, { failOnMissing: true }).ok).toBe(false);
  });

  it("fails when any story fails", () => {
    expect(
      summarizeResults([...results, { id: "c", status: "fail" as const }]).ok,
    ).toBe(false);
  });

  it("lists only non-passing stories in the markdown summary", () => {
    const md = formatSummaryMarkdown(results, summarizeResults(results));
    expect(md).toContain("1 passed, 0 failed, 1 new");
    expect(md).toContain("| `b` | new | no baseline yet |");
    expect(md).not.toContain("| `a` |");
  });
});

describe("CI wiring", () => {
  it("runs the visual regression job against the default template Storybook", async () => {
    const ci = await fs.readFile(
      path.join(ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(ci).toContain("visual-regression:");
    expect(ci).toContain("--template default");
    expect(ci).toContain("npm run build-storybook");
    expect(ci).toContain("npm run test:visual -- --storybook-dir vr-app/storybook-static");
  });

});
