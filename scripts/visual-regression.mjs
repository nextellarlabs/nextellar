#!/usr/bin/env node
/**
 * Playwright-screenshot visual regression for the default template's
 * Storybook (#1083).
 *
 *   node scripts/visual-regression.mjs --storybook-dir vr-app/storybook-static
 *   node scripts/visual-regression.mjs --storybook-dir ... --update   # (re)write baselines
 *
 * Options:
 *   --storybook-dir <dir>   static Storybook build (required)
 *   --baseline-dir <dir>    default tests/visual/__screenshots__/default
 *   --out-dir <dir>         default reports/visual (actual + diff PNGs, summary.json)
 *   --max-diff-ratio <n>    default 0.001 (0.1% of pixels)
 *   --update                write every capture as the new baseline
 *   --fail-on-missing       treat stories without a baseline as failures
 *
 * Only `playwright` (already a devDependency) is used: the static build is
 * served with node:http and images are compared on a <canvas> inside the
 * same headless Chromium, so no image-diff package is needed.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  DEFAULT_CHANNEL_TOLERANCE,
  DEFAULT_MAX_DIFF_RATIO,
  countDiffPixels,
  evaluateComparison,
  formatSummaryMarkdown,
  selectStories,
  snapshotFileName,
  storyUrl,
  summarizeResults,
} from "./lib/visual-regression.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const storybookDir = opt("--storybook-dir", null);
if (!storybookDir) {
  console.error("Missing --storybook-dir <path to storybook-static>.");
  process.exit(1);
}
const staticDir = path.resolve(process.cwd(), storybookDir);
const baselineDir = path.resolve(
  ROOT,
  opt("--baseline-dir", "tests/visual/__screenshots__/default"),
);
const outDir = path.resolve(ROOT, opt("--out-dir", "reports/visual"));
const maxDiffRatio = Number(
  opt("--max-diff-ratio", String(DEFAULT_MAX_DIFF_RATIO)),
);
const update = args.includes("--update");
const failOnMissing = args.includes("--fail-on-missing");

const indexPath = path.join(staticDir, "index.json");
if (!fs.existsSync(indexPath)) {
  console.error(
    `No index.json in ${staticDir}. Run \`npm run build-storybook\` in the scaffolded app first.`,
  );
  process.exit(1);
}
const stories = selectStories(JSON.parse(fs.readFileSync(indexPath, "utf8")));
if (stories.length === 0) {
  console.error("No component stories found in the Storybook build.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serve(dir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.join(dir, urlPath === "/" ? "index.html" : urlPath);
    if (
      !file.startsWith(dir) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

// Runs in the browser: decodes both PNGs onto canvases and counts pixels
// that differ by more than `tolerance` on any channel, painting a diff image.
async function compareInBrowser({ baseline, actual, tolerance, countSrc }) {
  const countDiff = new Function(`return (${countSrc})`)();
  const load = (b64) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
  const [a, b] = await Promise.all([load(baseline), load(actual)]);
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeMismatch: true };
  }
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  };
  const da = read(a);
  const db = read(b);
  const diffPixels = countDiff(da.data, db.data, tolerance);
  let diffPng = null;
  if (diffPixels > 0) {
    const c = document.createElement("canvas");
    c.width = a.width;
    c.height = a.height;
    const ctx = c.getContext("2d");
    const out = ctx.createImageData(a.width, a.height);
    for (let i = 0; i < da.data.length; i += 4) {
      const changed =
        Math.abs(da.data[i] - db.data[i]) > tolerance ||
        Math.abs(da.data[i + 1] - db.data[i + 1]) > tolerance ||
        Math.abs(da.data[i + 2] - db.data[i + 2]) > tolerance ||
        Math.abs(da.data[i + 3] - db.data[i + 3]) > tolerance;
      out.data[i] = changed ? 255 : da.data[i] * 0.3;
      out.data[i + 1] = changed ? 0 : da.data[i + 1] * 0.3;
      out.data[i + 2] = changed ? 0 : da.data[i + 2] * 0.3;
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    diffPng = c.toDataURL("image/png").split(",")[1];
  }
  return { diffPixels, totalPixels: a.width * a.height, diffPng };
}

const server = await serve(staticDir);
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const comparePage = await context.newPage();

fs.mkdirSync(path.join(outDir, "actual"), { recursive: true });
fs.mkdirSync(path.join(outDir, "diff"), { recursive: true });
if (update) fs.mkdirSync(baselineDir, { recursive: true });

const results = [];
try {
  for (const story of stories) {
    const file = snapshotFileName(story.id);
    let actual;
    try {
      await page.goto(storyUrl(baseUrl, story.id), { waitUntil: "networkidle" });
      await page.waitForSelector("#storybook-root", { state: "attached" });
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
      });
      await page.evaluate(() => document.fonts?.ready);
      actual = await page.screenshot({ fullPage: true, animations: "disabled" });
    } catch (err) {
      results.push({ id: story.id, status: "fail", reason: `capture failed: ${err.message}` });
      continue;
    }
    fs.writeFileSync(path.join(outDir, "actual", file), actual);

    const baselinePath = path.join(baselineDir, file);
    if (update) {
      fs.writeFileSync(baselinePath, actual);
      results.push({ id: story.id, status: "pass", reason: "baseline updated" });
      continue;
    }

    const hasBaseline = fs.existsSync(baselinePath);
    let comparison = { hasBaseline };
    if (hasBaseline) {
      const raw = await comparePage.evaluate(compareInBrowser, {
        baseline: fs.readFileSync(baselinePath).toString("base64"),
        actual: actual.toString("base64"),
        tolerance: DEFAULT_CHANNEL_TOLERANCE,
        countSrc: countDiffPixels.toString(),
      });
      if (raw.diffPng) {
        fs.writeFileSync(
          path.join(outDir, "diff", file),
          Buffer.from(raw.diffPng, "base64"),
        );
      }
      comparison = { hasBaseline, ...raw };
    }
    const verdict = evaluateComparison(comparison, { maxDiffRatio });
    results.push({ id: story.id, status: verdict.status, reason: verdict.reason });
    console.log(`${verdict.status.padEnd(4)} ${story.id}${verdict.reason ? ` (${verdict.reason})` : ""}`);
  }
} finally {
  await browser.close();
  server.close();
}

const summary = summarizeResults(results, { failOnMissing });
fs.writeFileSync(
  path.join(outDir, "summary.json"),
  `${JSON.stringify({ summary, results }, null, 2)}\n`,
);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    formatSummaryMarkdown(results, summary),
  );
}
console.log(
  `\n${summary.pass} passed, ${summary.fail} failed, ${summary.new} new of ${summary.total} stories.`,
);
process.exit(summary.ok ? 0 : 1);
