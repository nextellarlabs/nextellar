/**
 * `--with-pwa` overlay (#1496).
 *
 * Adds the three pieces an installable Next.js app needs — a web app
 * manifest, an icon set and a service worker — plus the small client
 * component that registers the worker.
 *
 * The static assets (manifest, icons, `sw.js`, offline shell) live in
 * `src/templates/pwa-template/public` so they are copied verbatim, exactly
 * like the contracts overlay. The registration component and the `<head>`
 * wiring are generated here because the layout differs per template and per
 * language (`.tsx` vs `.jsx`), and this overlay must compose with every
 * starter: `default`, `minimal`, `defi` and `full`.
 */
import path from "path";
import fs from "fs-extra";

export interface PwaOverlayOptions {
  /** Absolute path to the scaffolded project. */
  targetDir: string;
  /** Absolute path to the `src/templates` directory. */
  templatesRoot: string;
  /** Project name, used for the manifest's `name` and `short_name`. */
  appName: string;
  /** TypeScript project → `.tsx` registration component. */
  useTs: boolean;
}

export interface PwaOverlayResult {
  /** Project-relative paths of every file the overlay wrote. */
  files: string[];
}

const PWA_OVERLAY_DIR = "pwa-template";

const MANIFEST_REL = "public/manifest.webmanifest";
const OFFLINE_SHELL_REL = "public/offline.html";
const SERVICE_WORKER_REL = "public/sw.js";

const REGISTRATION_TSX = `"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in \`public/sw.js\` (added by
 * \`nextellar --with-pwa\`).
 *
 * Registration only runs in a production build: a service worker during
 * \`next dev\` would sit in front of the dev server's own assets and cache
 * hot-reload responses.
 */
export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.warn("[pwa] service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
`;

const REGISTRATION_JSX = `"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in \`public/sw.js\` (added by
 * \`nextellar --with-pwa\`).
 *
 * Registration only runs in a production build: a service worker during
 * \`next dev\` would sit in front of the dev server's own assets and cache
 * hot-reload responses.
 */
export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("[pwa] service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
`;

const REGISTRATION_IMPORT =
  'import PwaRegistration from "@/components/PwaRegistration";';

const HEAD_TAGS = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#0b1020" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
];

/** `short_name` is what an installed app icon shows; keep it short. */
export function toShortName(appName: string, maxLength = 12): string {
  const cleaned = appName.trim();
  if (cleaned.length <= maxLength) return cleaned;
  const cut = cleaned.slice(0, maxLength);
  const wordBreak = cut.lastIndexOf(" ");
  const trimmed = (wordBreak > 0 ? cut.slice(0, wordBreak) : cut).replace(
    /[\s-]+$/,
    "",
  );
  return trimmed || cleaned.slice(0, maxLength);
}

/**
 * Inserts the manifest/theme tags, the import and the `<PwaRegistration />`
 * element into an App Router layout. Idempotent: a layout that already
 * contains the import is returned unchanged.
 */
export function injectPwaIntoLayout(contents: string): string {
  if (contents.includes(REGISTRATION_IMPORT)) {
    return contents;
  }

  // Keep the file's existing line endings: the templates are CRLF, and mixed
  // endings would make every later diff of the generated layout noisy.
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  let next = contents;

  // 1. Import, right after the last top-level import.
  const importPattern = /^import[^\n]*\n/gm;
  let lastImportEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(next)) !== null) {
    lastImportEnd = match.index + match[0].length;
  }
  next =
    next.slice(0, lastImportEnd) +
    `${REGISTRATION_IMPORT}${eol}` +
    next.slice(lastImportEnd);

  // 2. Manifest link + theme colour, inside <head>.
  const indentAt = (index: number): string => {
    const lineStart = next.lastIndexOf("\n", index) + 1;
    return /^[ \t]*/.exec(next.slice(lineStart, index))?.[0] ?? "";
  };
  const headMatch = /<head[^>]*>/i.exec(next);
  if (headMatch) {
    const indent = indentAt(headMatch.index);
    const tags = HEAD_TAGS.map((tag) => `${indent}  ${tag}`).join(eol);
    const insertAt = headMatch.index + headMatch[0].length;
    const rest = next.slice(insertAt).replace(/^(?:[ \t]*\r?\n)+/, eol);
    next = next.slice(0, insertAt) + eol + tags + rest;
  } else {
    // Some layouts (the JavaScript starter) open `<html>` on the same line as
    // `return (`, so match the tag anywhere on its line rather than requiring
    // it at the start of one.
    const htmlOpen = /<html[^>]*>/i.exec(next);
    if (!htmlOpen) {
      throw new Error(
        "Could not add the PWA manifest link: no <html> or <head> element found in the app layout.",
      );
    }
    const indent = indentAt(htmlOpen.index);
    const tags = HEAD_TAGS.map((tag) => `${indent}    ${tag}`).join(eol);
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    const rest = next.slice(insertAt).replace(/^(?:[ \t]*\r?\n)+/, eol);
    next =
      next.slice(0, insertAt) +
      `${eol}${indent}  <head>${eol}${tags}${eol}${indent}  </head>` +
      rest;
  }

  // 3. The registration component, last thing in <body>.
  const bodyClose = /^([ \t]*)<\/body>/m.exec(next);
  if (!bodyClose) {
    throw new Error(
      "Could not add the PWA service worker registration: no </body> element found in the app layout.",
    );
  }
  const componentIndent = `${bodyClose[1] ?? ""}  `;
  next =
    next.slice(0, bodyClose.index) +
    `${componentIndent}<PwaRegistration />${eol}` +
    next.slice(bodyClose.index);

  return next;
}

async function findLayoutFile(targetDir: string): Promise<string | null> {
  for (const rel of [
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "src/app/layout.ts",
    "src/app/layout.js",
  ]) {
    const candidate = path.join(targetDir, rel);
    if (await fs.pathExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Copies the PWA overlay into `targetDir`, personalises the manifest and
 * wires the registration into the app layout.
 */
export async function applyPwaOverlay(
  options: PwaOverlayOptions,
): Promise<PwaOverlayResult> {
  const { targetDir, templatesRoot, appName, useTs } = options;
  const overlayDir = path.join(templatesRoot, PWA_OVERLAY_DIR);

  if (!(await fs.pathExists(overlayDir))) {
    throw new Error(
      `The PWA overlay is missing from ${templatesRoot}. Reinstall nextellar and try again.`,
    );
  }

  await fs.copy(overlayDir, targetDir, {
    filter: (src) => {
      const basename = path.basename(src);
      return basename !== ".git" && basename !== "node_modules";
    },
    preserveTimestamps: true,
  });

  const written: string[] = [
    MANIFEST_REL,
    OFFLINE_SHELL_REL,
    SERVICE_WORKER_REL,
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/icons/icon-maskable-512.png",
    "public/icons/apple-touch-icon.png",
  ];

  // Personalise the manifest. Must happen here (not via scaffold's
  // `filesToProcess`, which is a fixed list) so the tokens are resolved for
  // every template this overlay composes with.
  const manifestPath = path.join(targetDir, MANIFEST_REL);
  const manifest = await fs.readFile(manifestPath, "utf8");
  const personalised = manifest
    .replace(/\{\{APP_NAME\}\}/g, appName)
    .replace(/\{\{SHORT_NAME\}\}/g, toShortName(appName));
  await fs.writeFile(manifestPath, personalised, "utf8");

  const registrationRel = useTs
    ? "src/components/PwaRegistration.tsx"
    : "src/components/PwaRegistration.jsx";
  const registrationPath = path.join(targetDir, registrationRel);
  await fs.outputFile(
    registrationPath,
    useTs ? REGISTRATION_TSX : REGISTRATION_JSX,
    "utf8",
  );
  written.push(registrationRel);

  const layoutPath = await findLayoutFile(targetDir);
  if (!layoutPath) {
    throw new Error(
      "Could not find an App Router layout (src/app/layout.tsx or .jsx) to register the service worker in.",
    );
  }
  const layout = await fs.readFile(layoutPath, "utf8");
  const patched = injectPwaIntoLayout(layout);
  if (patched !== layout) {
    await fs.writeFile(layoutPath, patched, "utf8");
  }
  written.push(path.relative(targetDir, layoutPath).split(path.sep).join("/"));

  return { files: written };
}
