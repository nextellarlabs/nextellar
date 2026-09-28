/**
 * SEP-1: Stellar Info File — fetch and cache a domain's `stellar.toml` for
 * anchor/asset discovery.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
 *
 * Parsing, HTTP fetching, and the 5xx/`.well-known/stellar.toml` request
 * itself are delegated entirely to the SDK's `StellarToml.Resolver`
 * (also used by `sep30.ts`/`sep45.ts` in this template) rather than
 * hand-rolling a second TOML parser or HTTP client. This module adds:
 *   - domain-only input validation (no scheme/path/credentials/query),
 *   - an in-memory TTL cache keyed by normalized domain, and
 *   - a typed, non-throwing-by-default surface for callers.
 *
 * `StellarToml.Resolver.resolve` defaults `allowHttp` to `false` (HTTPS
 * only) and enforces `STELLAR_TOML_MAX_SIZE`, so plain-HTTP and unbounded
 * response bodies are already rejected by the SDK before this module sees
 * a response. This helper does not add a second SSRF-mitigation layer
 * beyond that — see the domain-format check below.
 */

import { StellarToml } from "@stellar/stellar-sdk";

// ── Types ──────────────────────────────────────────────────────────────────────

export type StellarTomlData = StellarToml.Api.StellarToml;

export interface FetchStellarTomlOptions {
  /** Allow plain HTTP (default: false — HTTPS only, per SEP-1). Never enable in production. */
  allowHttp?: boolean;
  /** Request timeout in ms, forwarded to the SDK resolver (default: SDK default, no timeout). */
  timeout?: number;
  /** Cache TTL in ms (default: 5 minutes). Set to 0 to disable caching for this call. */
  cacheTtlMs?: number;
  /** Bypass the cache and force a fresh fetch, then repopulate the cache. */
  forceRefresh?: boolean;
}

export class StellarTomlError extends Error {
  constructor(
    message: string,
    public readonly domain: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StellarTomlError";
  }
}

// ── Domain validation ────────────────────────────────────────────────────────────

// A bare hostname: labels of letters/digits/hyphens, at least one dot, no
// scheme, path, port, credentials, or query string. This is a fetch-target
// helper for a *domain*, not a generic URL fetcher — reject anything that
// looks like a URL rather than trying to strip it down to a domain.
const DOMAIN_RE =
  /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/;

/**
 * Validates and normalizes a domain for `fetchStellarToml`. Lowercases the
 * domain (DNS is case-insensitive) and rejects anything that isn't a bare
 * hostname — no `http(s)://`, path, port, userinfo, or query string.
 *
 * @throws {StellarTomlError} if `domain` is not a bare hostname.
 */
export function normalizeStellarTomlDomain(domain: string): string {
  const trimmed = domain.trim();
  if (!DOMAIN_RE.test(trimmed)) {
    throw new StellarTomlError(
      `"${domain}" is not a valid domain. Pass a bare hostname (e.g. "example.com"), not a URL.`,
      domain,
    );
  }
  return trimmed.toLowerCase();
}

// ── Cache ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: StellarTomlData;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, CacheEntry>();
// Coalesces concurrent fetches for the same domain into a single request.
const inFlight = new Map<string, Promise<StellarTomlData>>();

/** Clears the module-level `stellar.toml` cache. Exposed for tests. */
export function clearStellarTomlCache(): void {
  cache.clear();
  inFlight.clear();
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

/**
 * Fetches and parses `https://{domain}/.well-known/stellar.toml`, caching
 * the parsed result in-memory per normalized domain for `cacheTtlMs`
 * (default 5 minutes).
 *
 * @throws {StellarTomlError} if `domain` is malformed, or the request/parse fails.
 */
export async function fetchStellarToml(
  domain: string,
  opts: FetchStellarTomlOptions = {},
): Promise<StellarTomlData> {
  const normalized = normalizeStellarTomlDomain(domain);
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (!opts.forceRefresh && ttl > 0) {
    const cached = cache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const existing = inFlight.get(normalized);
  if (existing && !opts.forceRefresh) {
    return existing;
  }

  const request = (async () => {
    let data: StellarTomlData;
    try {
      data = await StellarToml.Resolver.resolve(normalized, {
        allowHttp: opts.allowHttp,
        timeout: opts.timeout,
      });
    } catch (err) {
      throw new StellarTomlError(
        `Failed to fetch or parse stellar.toml for "${normalized}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        normalized,
        err,
      );
    }

    if (ttl > 0) {
      cache.set(normalized, { data, expiresAt: Date.now() + ttl });
    }
    return data;
  })();

  inFlight.set(normalized, request);
  try {
    return await request;
  } finally {
    inFlight.delete(normalized);
  }
}
