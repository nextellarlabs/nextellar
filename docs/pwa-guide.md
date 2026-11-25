# PWA option (`--with-pwa`)

`--with-pwa` makes a scaffolded app installable: it adds a web app manifest,
an icon set, an offline shell and a service worker, and registers them from the
App Router layout.

```bash
npx nextellar my-app --with-pwa
npx nextellar my-app --template minimal --with-pwa
npx nextellar my-app --template defi --with-pwa --with-contracts
```

The flag composes with every starter (`default`, `minimal`, `defi`, `full`) and
with `--javascript`.

## What it adds

| File                                 | Purpose                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| `public/manifest.webmanifest`        | App name, `start_url`, standalone display, theme colours, icon list  |
| `public/icons/icon-192.png`          | Home-screen icon (Lighthouse requires 192×192)                       |
| `public/icons/icon-512.png`          | Splash/install icon (Lighthouse requires 512×512)                    |
| `public/icons/icon-maskable-512.png` | Maskable icon for Android adaptive icons                             |
| `public/icons/apple-touch-icon.png`  | iOS home-screen icon                                                 |
| `public/sw.js`                       | Service worker: app-shell precache, navigation fallback, asset cache |
| `public/offline.html`                | Offline shell shown for a failed navigation                          |
| `src/components/PwaRegistration.tsx` | Client component that registers `/sw.js`                             |

The layout gains three lines: a `<link rel="manifest">`, a `theme-color` meta
tag, and `<PwaRegistration />` at the end of `<body>`. In a JavaScript project
the component is `PwaRegistration.jsx` and the layout is `layout.jsx`.

The service worker only registers in a production build (`npm run build` +
`npm start`). During `next dev` it stays inactive, so hot reload is unaffected.

## Caching policy: what is never stored

The worker caches the app shell and immutable build assets. Everything else
goes straight to the network, uncached. A request is **never** cached when it is:

- not a `GET` — every transaction submission (`POST /transactions`, Soroban
  `sendTransaction`) is skipped;
- cross-origin — Horizon, Soroban RPC and wallet relays are never cached, even
  if you proxy them onto the same origin;
- for an `/api/`, `/auth/`, `/_next/data/`, `/webhooks/` or `/rpc/` path;
- carrying an `Authorization` header or a `X-Stellar-Signature` header;
- answered with `Cache-Control: no-store` or `private`.

Navigations are network-first: a fresh page when online, the last cached page or
`public/offline.html` when not. Static assets are stale-while-revalidate. Bump
`CACHE_VERSION` in `public/sw.js` when you change the app shell; old caches are
deleted on `activate`.

If you add your own endpoints, keep account data on paths under `/api/` (already
excluded) or extend `NEVER_CACHE_PATH_PREFIXES` in `public/sw.js`.

## Verifying locally

```bash
npm run build
npm start
# then: DevTools → Application → Manifest / Service Workers
```

The repository's CI runs the PWA job in `.github/workflows/ci.yml`: it scaffolds
`--with-pwa`, builds it, checks the installability surface with
`node scripts/check-pwa.mjs <app-dir>` (manifest fields, icon sizes on disk,
layout wiring, worker caching guards), and runs Lighthouse CI with
`.lighthouserc.pwa.json`. To reproduce:

```bash
node dist/bin/nextellar.js pwa-app --defaults --skip-install --with-pwa
cd pwa-app && npm install && npm run build
cd .. && node scripts/check-pwa.mjs pwa-app
cp .lighthouserc.pwa.json pwa-app/ && cd pwa-app
npx @lhci/cli autorun --config=.lighthouserc.pwa.json
```

## Customising

- **Name**: the manifest's `name`/`short_name` come from the project name.
  Rename them in `public/manifest.webmanifest`; keep `short_name` under ~12
  characters so it is not truncated on a home screen.
- **Colours**: change `theme_color`/`background_color` in the manifest and the
  `theme-color` meta tag in `src/app/layout.*`.
- **Icons**: replace the PNGs in `public/icons/` keeping the same file names and
  sizes, or add entries to the manifest's `icons` array.
- **Offline page**: edit `public/offline.html`; it is precached on install.
