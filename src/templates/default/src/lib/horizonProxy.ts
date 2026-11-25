/**
 * Horizon proxy helpers (#1461).
 *
 * Scaffolded apps normally talk to Horizon straight from the browser using
 * `NEXT_PUBLIC_HORIZON_URL`. Hosted Horizon providers require an API key,
 * which must never be shipped in a `NEXT_PUBLIC_*` variable. When
 * `NEXT_PUBLIC_HORIZON_PROXY=true`, client hooks point at the same-origin
 * `/api/horizon` route instead, and that route injects the key server-side.
 *
 * This module is safe to import from client components: it only reads the
 * public opt-in flag. The server-only secrets (`HORIZON_PROXY_API_KEY`,
 * `HORIZON_PROXY_URL`, ...) are read in the route handler itself.
 */

/** Same-origin path served by `src/app/api/horizon/[...path]/route.ts`. */
export const HORIZON_PROXY_PATH = "/api/horizon";

/** `NEXT_PUBLIC_HORIZON_PROXY` values treated as enabled. */
const TRUTHY_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Whether client hooks should route Horizon reads through the local proxy.
 * Must read `process.env.NEXT_PUBLIC_HORIZON_PROXY` literally so Next.js can
 * inline it at build time.
 */
export function isHorizonProxyEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_HORIZON_PROXY;
  if (typeof raw !== "string") return false;
  return TRUTHY_FLAG_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Returns the Horizon base URL a client hook should use: the proxy when the
 * opt-in flag is set, otherwise the direct URL (unchanged).
 *
 * In the browser we build an absolute URL so the Stellar SDK (which rejects
 * some relative endpoints) and `EventSource` both work. During server-side
 * rendering we return the relative path; hooks only fetch from effects, so
 * this value never drives an SSR request.
 */
export function resolveHorizonUrl(directUrl: string): string {
  if (!isHorizonProxyEnabled()) return directUrl;

  if (
    typeof window !== "undefined" &&
    window.location &&
    typeof window.location.origin === "string" &&
    window.location.origin.length > 0
  ) {
    return `${window.location.origin}${HORIZON_PROXY_PATH}`;
  }

  return HORIZON_PROXY_PATH;
}

/** Path segments may only contain characters used by real Horizon routes. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

const ACCOUNT_ID = "[A-Za-z0-9]{56}";
const HASH = "[0-9a-fA-F]{64}";

/**
 * Read-only Horizon endpoints the proxy is willing to forward.
 *
 * Keep this list explicit instead of proxying every path: a catch-all proxy
 * would let any caller reach arbitrary provider endpoints (and, with a
 * server-side key, spend the app's quota). Add new entries deliberately.
 */
const ALLOWED_PATHS: readonly RegExp[] = [
  // Accounts and their sub-resources.
  new RegExp(`^accounts/${ACCOUNT_ID}$`),
  new RegExp(
    `^accounts/${ACCOUNT_ID}/(balances|claimable_balances|data|effects|offers|operations|payments|signers|trades|transactions)$`,
  ),
  // Ledgers.
  /^ledgers(\/[0-9]+)?$/,
  /^ledgers\/[0-9]+\/(effects|operations|payments|transactions)$/,
  // Transactions.
  new RegExp(`^transactions(/${HASH})?$`),
  new RegExp(`^transactions/${HASH}/(effects|operations|payments)$`),
  // Operations.
  /^operations(\/[0-9]+)?$/,
  /^operations\/[0-9]+\/(effects|transactions)$/,
  /^payments$/,
  /^effects$/,
  // Reference data.
  /^fee_stats$/,
  /^network$/,
  /^assets$/,
  /^order_book$/,
  /^trade_aggregations$/,
  // Claimable balances and liquidity pools. Claimable balance ids are 72 hex
  // characters (8-byte type prefix + 32-byte hash).
  /^claimable_balances(\/[0-9a-fA-F]{72})?$/,
  new RegExp(`^liquidity_pools(/${HASH})?$`),
  new RegExp(
    `^liquidity_pools/${HASH}/(effects|operations|trades|transactions)$`,
  ),
  // Strict send / strict receive path finding.
  /^paths\/(strict-send|strict-receive)$/,
];

/**
 * True when the catch-all segments match an allowlisted Horizon path.
 *
 * The check rejects empty paths, encoded traversal (`..`) and any unknown
 * suffix, so `/api/horizon/admin` or `/accounts/<id>/secret` never reaches
 * the provider.
 */
export function isAllowedHorizonPath(segments: readonly string[]): boolean {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  if (segments.length > 5) return false;
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) return false;

  const pathname = segments.join("/");
  return ALLOWED_PATHS.some((pattern) => pattern.test(pathname));
}
