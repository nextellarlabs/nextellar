/**
 * `--with-pwa` overlay (#1496).
 *
 * The PWA option must add a manifest, an icon set, an offline shell and a
 * service worker to the generated project, wire them into the app layout, and
 * never regress into caching signed transactions or secret-bearing API
 * responses.
 */
import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const mockRunInstall = jest.fn();
jest.unstable_mockModule("../src/lib/install.js", () => ({
  detectPackageManager: () => "npm",
  runInstall: mockRunInstall,
}));

const mockExeca = jest.fn();
jest.unstable_mockModule("execa", () => ({ execa: mockExeca }));
jest.unstable_mockModule("../src/lib/preflight.js", () => ({
  runPreflight: async () => ({ ok: true, failures: [] }),
  setPreflightDisabledForTest: () => {},
  setNpmRunnerForTest: () => {},
  checkNodeVersion: () => ({ ok: true, detail: "test", fix: "" }),
  checkNpmAvailable: async () => ({ ok: true, detail: "test npm OK", fix: "" }),
}));

const { scaffold } = await import("../src/lib/scaffold");
const { injectPwaIntoLayout, toShortName } = await import("../src/lib/pwa");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_ROOT = path.resolve(__dirname, "../src/templates");

jest.setTimeout(30000);

const pngSize = (buffer: Buffer): { width: number; height: number } => ({
  width: buffer.readUInt32BE(16),
  height: buffer.readUInt32BE(20),
});

describe("--with-pwa overlay", () => {
  let origCwd: string | undefined;
  // Directories scaffolded by a single test, removed after it.
  const tmpParents: string[] = [];
  // Directories shared by a whole describe block, removed in afterAll.
  const suiteParents: string[] = [];

  const makeTempParent = async (bucket: string[]) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-pwa-"));
    bucket.push(dir);
    return dir;
  };

  const scaffoldApp = async (
    options: {
      appName: string;
      useTs: boolean;
      template?: string;
      withPwa?: boolean;
    },
    bucket: string[] = tmpParents,
  ) => {
    origCwd = process.cwd();
    const parent = await makeTempParent(bucket);
    process.chdir(parent);
    await scaffold({
      skipInstall: true,
      ...options,
    } as Parameters<typeof scaffold>[0]);
    return { parent, targetDir: path.join(parent, options.appName) };
  };

  beforeEach(() => {
    mockRunInstall.mockImplementation(async (options) => ({
      success: true,
      packageManager: options.skipInstall ? "skipped" : "npm",
    }));
    mockExeca.mockReset();
    mockExeca.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (origCwd) process.chdir(origCwd);
    await Promise.all(
      tmpParents.splice(0).map((dir) => fs.remove(dir).catch(() => undefined)),
    );
  });

  afterAll(async () => {
    if (origCwd) process.chdir(origCwd);
    await Promise.all(
      suiteParents
        .splice(0)
        .map((dir) => fs.remove(dir).catch(() => undefined)),
    );
  });

  describe("generated files (TypeScript)", () => {
    let targetDir: string;

    beforeAll(async () => {
      const app = await scaffoldApp(
        {
          appName: "pwa-ts-app",
          useTs: true,
          withPwa: true,
        },
        suiteParents,
      );
      targetDir = app.targetDir;
    });

    it("ships the manifest, service worker, offline shell and icons", async () => {
      for (const rel of [
        "public/manifest.webmanifest",
        "public/sw.js",
        "public/offline.html",
        "public/icons/icon-192.png",
        "public/icons/icon-512.png",
        "public/icons/icon-maskable-512.png",
        "public/icons/apple-touch-icon.png",
      ]) {
        expect(
          await fs.pathExists(path.join(targetDir, rel)),
          `${rel} should exist`,
        ).toBe(true);
      }
    });

    it("writes an installable manifest with 192/512 and maskable icons", async () => {
      const raw = await fs.readFile(
        path.join(targetDir, "public/manifest.webmanifest"),
        "utf8",
      );
      expect(raw).not.toMatch(/\{\{[A-Z_]+\}\}/);

      const manifest = JSON.parse(raw);
      expect(manifest.name).toBe("pwa-ts-app");
      expect(manifest.short_name).toBe("pwa-ts-app");
      expect(manifest.start_url).toBe("/");
      expect(manifest.display).toBe("standalone");
      expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);

      const icons = manifest.icons as Array<{
        src: string;
        sizes: string;
        type: string;
        purpose?: string;
      }>;
      expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
      expect(icons.some((icon) => icon.sizes === "512x512")).toBe(true);
      expect(
        icons.some(
          (icon) =>
            icon.sizes === "512x512" &&
            (icon.purpose ?? "").includes("maskable"),
        ),
      ).toBe(true);

      // Every icon the manifest advertises actually exists, at the size it
      // claims, so the install prompt and Lighthouse's checks both pass.
      for (const icon of icons) {
        const iconPath = path.join(
          targetDir,
          "public",
          icon.src.replace(/^\//, ""),
        );
        expect(await fs.pathExists(iconPath), `${icon.src} should exist`).toBe(
          true,
        );
        const [width, height] = icon.sizes.split("x").map(Number);
        expect(pngSize(await fs.readFile(iconPath))).toEqual({ width, height });
      }
    });

    it("registers the layout: manifest link, theme colour and component", async () => {
      const layout = await fs.readFile(
        path.join(targetDir, "src/app/layout.tsx"),
        "utf8",
      );
      expect(layout).toContain(
        'import PwaRegistration from "@/components/PwaRegistration";',
      );
      expect(layout).toContain(
        '<link rel="manifest" href="/manifest.webmanifest" />',
      );
      expect(layout).toContain('<meta name="theme-color" content="#0b1020" />');
      expect(layout).toContain(
        '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
      );
      expect(layout).toContain("<PwaRegistration />");
      // The component must be inside <body>, not stranded in <head>.
      expect(layout.indexOf("<PwaRegistration />")).toBeGreaterThan(
        layout.indexOf("<body"),
      );
      expect(layout.indexOf("<PwaRegistration />")).toBeLessThan(
        layout.indexOf("</body>"),
      );
    });

    it("ships a client component that registers /sw.js in production only", async () => {
      const registration = await fs.readFile(
        path.join(targetDir, "src/components/PwaRegistration.tsx"),
        "utf8",
      );
      expect(registration).toContain('"use client"');
      expect(registration).toContain(
        'navigator.serviceWorker.register("/sw.js")',
      );
      expect(registration).toContain('process.env.NODE_ENV !== "production"');
      expect(registration).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it("never caches signed transactions or secret-bearing API responses", async () => {
      const sw = await fs.readFile(
        path.join(targetDir, "public/sw.js"),
        "utf8",
      );

      // Non-GET (every transaction submission) is skipped.
      expect(sw).toContain('if (request.method !== "GET") return false;');
      // Authenticated requests are skipped.
      expect(sw).toContain('request.headers.has("authorization")');
      expect(sw).toContain('request.headers.has("x-stellar-signature")');
      // API/auth/webhook paths and Stellar RPC hosts are skipped.
      expect(sw).toContain('"/api/"');
      expect(sw).toContain('"/auth/"');
      expect(sw).toContain('"/webhooks/"');
      expect(sw).toContain('"horizon-testnet.stellar.org"');
      // Cross-origin requests (Horizon/Soroban/wallet relays) are skipped.
      expect(sw).toContain("if (!isSameOrigin(url)) return false;");
      // Responses marked private/no-store are never persisted.
      expect(sw).toContain("/no-store|private/i");
      // Offline navigations fall back to the cached shell.
      expect(sw).toContain('const OFFLINE_URL = "/offline.html";');
      expect(sw).toContain("caches.match(request)");
    });
  });

  describe("generated files (JavaScript)", () => {
    it("uses .jsx components and wires the .jsx layout", async () => {
      const { targetDir } = await scaffoldApp({
        appName: "pwa-js-app",
        useTs: false,
        withPwa: true,
      });

      expect(
        await fs.pathExists(
          path.join(targetDir, "src/components/PwaRegistration.jsx"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(targetDir, "src/components/PwaRegistration.tsx"),
        ),
      ).toBe(false);

      const layout = await fs.readFile(
        path.join(targetDir, "src/app/layout.jsx"),
        "utf8",
      );
      expect(layout).toContain(
        'import PwaRegistration from "@/components/PwaRegistration";',
      );
      expect(layout).toContain("<PwaRegistration />");
      // The JS layout has no <head>; one is added for the manifest link.
      expect(layout).toContain("<head>");
      expect(layout).toContain(
        '<link rel="manifest" href="/manifest.webmanifest" />',
      );

      const manifest = JSON.parse(
        await fs.readFile(
          path.join(targetDir, "public/manifest.webmanifest"),
          "utf8",
        ),
      );
      expect(manifest.name).toBe("pwa-js-app");
    });
  });

  it("composes with the minimal template", async () => {
    const { targetDir } = await scaffoldApp({
      appName: "pwa-minimal",
      useTs: true,
      template: "minimal",
      withPwa: true,
    });

    expect(await fs.pathExists(path.join(targetDir, "public/sw.js"))).toBe(
      true,
    );
    const layout = await fs.readFile(
      path.join(targetDir, "src/app/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("<PwaRegistration />");
  });

  it("leaves the project untouched without --with-pwa", async () => {
    const { targetDir } = await scaffoldApp({
      appName: "no-pwa-app",
      useTs: true,
    });

    for (const rel of [
      "public/manifest.webmanifest",
      "public/sw.js",
      "public/offline.html",
      "public/icons/icon-192.png",
      "src/components/PwaRegistration.tsx",
    ]) {
      expect(await fs.pathExists(path.join(targetDir, rel))).toBe(false);
    }

    const layout = await fs.readFile(
      path.join(targetDir, "src/app/layout.tsx"),
      "utf8",
    );
    const pristine = await fs.readFile(
      path.join(TEMPLATES_ROOT, "default/src/app/layout.tsx"),
      "utf8",
    );
    expect(layout).toBe(pristine);
    expect(layout).not.toContain("PwaRegistration");
  });

  it("is idempotent when the layout is already wired", () => {
    const layout = `import Link from "next/link";\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <head></head>\n      <body>{children}</body>\n    </html>\n  );\n}\n`;
    const once = injectPwaIntoLayout(layout);
    expect(injectPwaIntoLayout(once)).toBe(once);
    expect(once.match(/<PwaRegistration \/>/g)).toHaveLength(1);
    expect(once.match(/rel="manifest"/g)).toHaveLength(1);
  });

  it("truncates long project names for the manifest short_name", () => {
    expect(toShortName("stellar-dapp")).toBe("stellar-dapp");
    expect(toShortName("my-super-long-stellar-dapp")).toBe("my-super");
    expect(toShortName("abcdefghijklmnop")).toBe("abcdefghijkl");
  });

  it("keeps the overlay out of the template registry", async () => {
    // pwa-template is an add-on, not a --template value: it ships no
    // package.json of its own.
    expect(
      await fs.pathExists(
        path.join(TEMPLATES_ROOT, "pwa-template/package.json"),
      ),
    ).toBe(false);
  });
});
