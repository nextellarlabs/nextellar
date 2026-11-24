#!/usr/bin/env node
/**
 * PWA installability checks for a `--with-pwa` scaffolded app (#1496).
 *
 * Lighthouse's PWA category was folded into DevTools' own panel, so CI keeps
 * the objective parts of those checks here: the manifest is installable, its
 * icons exist at the advertised sizes, the layout links the manifest, the
 * service worker is served from the origin root, and the worker's caching
 * gate never stores signed transactions or secret-bearing responses.
 *
 *   node scripts/check-pwa.mjs lhci-pwa-app
 *
 * Exits non-zero with a list of problems when anything is missing.
 */
import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(process.argv[2] ?? process.cwd());
const problems = [];

function fail(message) {
  problems.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(appDir, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(appDir, rel));
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// --- manifest ---------------------------------------------------------------
const manifestRel = "public/manifest.webmanifest";
if (!exists(manifestRel)) {
  fail(`${manifestRel} is missing`);
} else {
  let manifest = null;
  try {
    manifest = JSON.parse(read(manifestRel));
  } catch (error) {
    fail(`${manifestRel} is not valid JSON: ${error.message}`);
  }

  if (manifest) {
    if (!manifest.name) fail("manifest.name is required");
    if (!manifest.short_name) fail("manifest.short_name is required");
    if (manifest.start_url !== "/") fail('manifest.start_url should be "/"');
    if (manifest.display !== "standalone") {
      fail('manifest.display should be "standalone"');
    }
    if (!manifest.theme_color) fail("manifest.theme_color is required");
    if (!manifest.background_color)
      fail("manifest.background_color is required");

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    if (icons.length === 0) fail("manifest.icons is empty");

    const sizes = new Set(icons.map((icon) => icon.sizes));
    if (!sizes.has("192x192")) fail("manifest needs a 192x192 icon");
    if (!sizes.has("512x512")) fail("manifest needs a 512x512 icon");
    const hasMaskable = icons.some((icon) =>
      String(icon.purpose ?? "").includes("maskable"),
    );
    if (!hasMaskable) fail("manifest needs a maskable icon");

    for (const icon of icons) {
      const iconPath = path.join(
        appDir,
        "public",
        String(icon.src).replace(/^\//, ""),
      );
      if (!fs.existsSync(iconPath)) {
        fail(`icon ${icon.src} does not exist in public/`);
        continue;
      }
      const [width, height] = String(icon.sizes).split("x").map(Number);
      const actual = pngSize(iconPath);
      if (!actual || actual.width !== width || actual.height !== height) {
        fail(
          `icon ${icon.src} is not ${icon.sizes} (found ${JSON.stringify(actual)})`,
        );
      }
    }
  }
}

// --- offline shell + service worker ----------------------------------------
if (!exists("public/offline.html")) fail("public/offline.html is missing");

const swRel = "public/sw.js";
if (!exists(swRel)) {
  fail(`${swRel} is missing`);
} else {
  const sw = read(swRel);
  // A worker at /sw.js controls the whole origin; one under a sub-path would
  // not, so the location matters as much as the file.
  const guards = [
    [
      'if (request.method !== "GET") return false;',
      "non-GET requests are cached",
    ],
    ['request.headers.has("authorization")', "authorized requests are cached"],
    ['"/api/"', "API responses are cached"],
    ['"/auth/"', "auth responses are cached"],
    ['"/webhooks/"', "webhook responses are cached"],
    [
      "if (!isSameOrigin(url)) return false;",
      "cross-origin Horizon/RPC requests are cached",
    ],
    ["/no-store|private/i", "private/no-store responses are stored"],
  ];
  for (const [needle, problem] of guards) {
    if (!sw.includes(needle)) fail(`${swRel}: ${problem}`);
  }
  if (!sw.includes('"/offline.html"')) fail(`${swRel}: no offline fallback`);
}

// --- layout wiring ---------------------------------------------------------
const layoutRel = ["src/app/layout.tsx", "src/app/layout.jsx"].find(exists);
if (!layoutRel) {
  fail("src/app/layout.tsx (or .jsx) is missing");
} else {
  const layout = read(layoutRel);
  if (!layout.includes('rel="manifest"'))
    fail(`${layoutRel} does not link the manifest`);
  if (!layout.includes("<PwaRegistration />")) {
    fail(`${layoutRel} does not render <PwaRegistration />`);
  }
  if (!layout.includes('name="theme-color"')) {
    fail(`${layoutRel} does not set a theme-color meta tag`);
  }
}

if (problems.length > 0) {
  console.error(`\n✗ PWA checks failed for ${appDir}\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ PWA checks passed for ${appDir}`);
