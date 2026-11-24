/*
 * Nextellar service worker (#1496).
 *
 * Caching policy, in one sentence: the app shell and immutable build assets
 * are cached; anything that could carry a signed transaction, an
 * authorization token, or a wallet/RPC secret is never cached at all.
 *
 * Concretely, a request is never cached when it is:
 *   - not a GET (every Stellar transaction submission is a POST),
 *   - cross-origin (Horizon / Soroban RPC / wallet relays),
 *   - for an API, auth, Next.js data or webhook path,
 *   - carrying an Authorization header,
 *   - answered with `Cache-Control: no-store` or `private`.
 *
 * Bump CACHE_VERSION when the shell changes; old caches are removed on
 * activate.
 */
const CACHE_PREFIX = "nextellar";
const CACHE_VERSION = "v1";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;

const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/*
 * Paths whose responses may contain account data or secrets. Kept as
 * prefixes so nested routes (`/api/sep24/status`) are covered too.
 */
const NEVER_CACHE_PATH_PREFIXES = [
  "/api/",
  "/auth/",
  "/_next/data/",
  "/webhooks/",
  "/rpc/",
];

/* Stellar endpoints are never served from the cache, even if same-origin. */
const NEVER_CACHE_HOSTS = [
  "horizon.stellar.org",
  "horizon-testnet.stellar.org",
  "soroban.stellar.org",
  "soroban-testnet.stellar.org",
];

const STATIC_ASSET_PATTERN =
  /\/(?:_next\/static|icons|images|fonts)\/|\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?)$/i;

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/**
 * The single gate every request passes through before it may be cached.
 * Exposed on `self` so the generated project's tests can exercise it
 * without a browser.
 */
function isCacheableRequest(request) {
  // Signed XDRs are always POSTed; never store a request body.
  if (request.method !== "GET") return false;
  // Authenticated responses (SEP-10 JWTs, session cookies' bearer tokens).
  if (
    request.headers.has("authorization") ||
    request.headers.has("x-stellar-signature")
  ) {
    return false;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return false;
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return false;
  if (NEVER_CACHE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return false;
  }

  return true;
}

function isStaticAsset(url) {
  return STATIC_ASSET_PATTERN.test(url.pathname);
}

async function shouldStore(response) {
  if (!response || !response.ok) return false;
  if (response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") || "";
  // `private`/`no-store` responses belong to one user and must never be shared.
  return !/no-store|private/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll rejects the whole batch on one failure; tolerate that so a
      // missing optional asset never blocks the service worker.
      await cache.addAll(PRECACHE_URLS).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(`${CACHE_PREFIX}-`) &&
              key !== SHELL_CACHE &&
              key !== RUNTIME_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Navigations: fresh HTML when online, cached page or offline shell when not. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (await shouldStore(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.open(SHELL_CACHE);
    const offline = await shell.match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

/** Immutable assets: serve the cached copy, refresh it in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (await shouldStore(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (!isCacheableRequest(request)) {
    // Network only: no respondWith, so nothing is read from or written to a cache.
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(new URL(request.url))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Lets `node --test`-style harnesses and the scaffold tests inspect the gate.
self.__nextellarPwa = { isCacheableRequest, isStaticAsset };
