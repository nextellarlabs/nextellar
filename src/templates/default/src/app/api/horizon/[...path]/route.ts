/**
 * Horizon proxy route (#1461).
 *
 * Forwards an allowlist of read-only Horizon paths to the upstream provider
 * while keeping the provider's API key server-side. Client hooks opt in by
 * setting `NEXT_PUBLIC_HORIZON_PROXY=true`; they then call `/api/horizon/...`
 * instead of the provider URL in `NEXT_PUBLIC_HORIZON_URL`.
 *
 * The route only accepts GET (Horizon reads are idempotent), caches successful
 * responses for a few seconds, and forwards provider rate-limit headers so the
 * existing client-side `HorizonRateLimiter` still sees `429`s and
 * `Retry-After`.
 */
import { isAllowedHorizonPath } from "../../../../lib/horizonProxy";

/**
 * Never let Next.js cache the route itself: whether a request is served from
 * the short-lived in-memory cache below must be decided per request, and the
 * response depends on server-only env vars.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
const DEFAULT_CACHE_TTL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CACHE_ENTRIES = 100;

/**
 * Upstream headers that matter to clients. Rate-limit headers feed the
 * template's `HorizonRateLimiter`; `content-type` keeps JSON parsing working.
 * Everything else (cookies, CORS headers, provider internals) is dropped.
 */
const FORWARDED_HEADERS = [
  "content-type",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-used",
] as const;

type CachedResponse = {
  expiresAt: number;
  status: number;
  body: string;
  headers: Array<[string, string]>;
};

/**
 * Route handlers are long-lived in a running Next.js server, so a module-level
 * map gives us a cheap per-instance cache without adding a dependency. It is
 * intentionally bounded and best-effort: multiple instances/regions each keep
 * their own copy, which is fine for a "briefly cache idempotent GETs" goal.
 */
const responseCache = new Map<string, CachedResponse>();

function jsonError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getUpstreamBaseUrl(): string {
  const raw =
    process.env.HORIZON_PROXY_URL ||
    process.env.NEXT_PUBLIC_HORIZON_URL ||
    DEFAULT_HORIZON_URL;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`HORIZON_PROXY_URL is not a valid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HORIZON_PROXY_URL must use http or https");
  }

  return raw.replace(/\/+$/, "");
}

/**
 * Inject the provider key server-side. `HORIZON_PROXY_API_KEY_HEADER` lets
 * providers that expect a custom header (e.g. `X-Api-Key`) work too; for the
 * standard `Authorization` header we send a bearer token.
 */
function applyApiKey(headers: Headers): void {
  const apiKey = process.env.HORIZON_PROXY_API_KEY;
  if (!apiKey) return;

  const headerName =
    process.env.HORIZON_PROXY_API_KEY_HEADER?.trim() || "Authorization";
  const value =
    headerName.toLowerCase() === "authorization"
      ? `Bearer ${apiKey}`
      : apiKey;

  headers.set(headerName, value);
}

function forwardedHeaders(upstream: Headers): Array<[string, string]> {
  const headers: Array<[string, string]> = [];
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.get(name);
    if (value !== null) headers.push([name, value]);
  }
  return headers;
}

function storeInCache(key: string, entry: CachedResponse): void {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, entry);
}

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const resolvedParams = await context.params;
  const segments = resolvedParams?.path ?? [];

  if (!isAllowedHorizonPath(segments)) {
    return jsonError(400, "Path is not allowed by the Horizon proxy allowlist");
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(
      segments.join("/"),
      `${getUpstreamBaseUrl()}/`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid Horizon proxy config";
    return jsonError(500, message);
  }

  // Forward the caller's query string (pagination, filters, ...) but never
  // their headers — the provider key is the only credential we send upstream.
  const incomingUrl = new URL(request.url);
  incomingUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });

  const cacheKey = `${upstreamUrl.pathname}?${upstreamUrl.searchParams.toString()}`;
  const cacheTtlMs = readPositiveInt(
    "HORIZON_PROXY_CACHE_TTL_MS",
    DEFAULT_CACHE_TTL_MS,
  );

  if (cacheTtlMs > 0) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(cached.body, {
        status: cached.status,
        headers: {
          ...Object.fromEntries(cached.headers),
          "x-nextellar-proxy-cache": "HIT",
          "cache-control": "no-store",
        },
      });
    }
    if (cached) responseCache.delete(cacheKey);
  }

  const requestHeaders = new Headers({ accept: "application/json" });
  applyApiKey(requestHeaders);

  const timeoutMs = readPositiveInt(
    "HORIZON_PROXY_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: requestHeaders,
      signal: controller.signal,
      cache: "no-store",
    });

    const body = await upstreamResponse.text();
    const headers = forwardedHeaders(upstreamResponse.headers);

    // Only cache successful reads. Errors and 429s must reach the client so
    // the client-side rate limiter can back off.
    if (cacheTtlMs > 0 && upstreamResponse.status === 200) {
      storeInCache(cacheKey, {
        expiresAt: Date.now() + cacheTtlMs,
        status: upstreamResponse.status,
        body,
        headers,
      });
    }

    return new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...Object.fromEntries(headers),
        "x-nextellar-proxy-cache": "MISS",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return jsonError(504, "Horizon proxy request timed out");
    }
    const message =
      error instanceof Error ? error.message : "Unknown upstream error";
    return jsonError(502, `Horizon proxy request failed: ${message}`);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

/** The proxy is read-only: writes still go through the wallet/provider path. */
export function POST(): Response {
  return jsonError(405, "Method not allowed", { allow: "GET" });
}
