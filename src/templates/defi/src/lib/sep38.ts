/**
 * SEP-38: Anchor RFQ (quote) API — client helpers for requesting indicative
 * and firm quotes from a SEP-38 quote server.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md
 *
 * Discovery follows the same pattern as `sep30.ts`/`sep45.ts`: resolve
 * `ANCHOR_QUOTE_SERVER` from `stellar.toml` via `fetchStellarToml` (sep1.ts),
 * then talk to that server directly. This module implements the client side
 * only — `GET /prices`, `GET /price` (indicative), and `POST /quote` (firm)
 * — not the server side.
 */

import { fetchStellarToml } from "./sep1";

// ── Types ──────────────────────────────────────────────────────────────────────

/** An on/off-chain asset identifier in SEP-38's `<scheme>:<identifier>` form. */
export type Sep38Asset = string;

export interface Sep38DiscoverOptions {
  allowHttp?: boolean;
}

/**
 * Resolves `ANCHOR_QUOTE_SERVER` from `homeDomain`'s `stellar.toml`.
 *
 * @throws if `stellar.toml` cannot be resolved, or is missing `ANCHOR_QUOTE_SERVER`.
 */
export async function discoverSep38QuoteServer(
  homeDomain: string,
  opts: Sep38DiscoverOptions = {},
): Promise<string> {
  const toml = await fetchStellarToml(homeDomain, {
    allowHttp: opts.allowHttp,
  });
  const serverUrl = toml.ANCHOR_QUOTE_SERVER as string | undefined;
  if (!serverUrl) {
    throw new Error(
      `discoverSep38QuoteServer: "${homeDomain}" stellar.toml is missing ANCHOR_QUOTE_SERVER.`,
    );
  }
  return serverUrl;
}

/** Common fields shared by an indicative price and a firm quote. */
interface Sep38QuoteBase {
  /** The asset the client is selling, in SEP-38 asset identification format. */
  sellAsset: Sep38Asset;
  /** The asset the client is buying, in SEP-38 asset identification format. */
  buyAsset: Sep38Asset;
  /** Conversion price: how many units of `sellAsset` for one unit of `buyAsset`. */
  price: string;
  /** Amount of `sellAsset` involved in the conversion, as a string decimal. */
  sellAmount: string;
  /** Amount of `buyAsset` involved in the conversion, as a string decimal. */
  buyAmount: string;
}

/**
 * An **indicative** price from `GET /price` or `GET /prices` — informational
 * only, not binding, and not executable. Never treat this as a firm quote.
 */
export interface Sep38IndicativePrice extends Sep38QuoteBase {
  kind: "indicative";
}

/**
 * A **firm** quote from `POST /quote` — binding until `expiresAt`, and
 * identified by `id` so it can be referenced by a subsequent SEP-6/SEP-24/
 * SEP-31 transaction.
 */
export interface Sep38FirmQuote extends Sep38QuoteBase {
  kind: "firm";
  /** Unique quote identifier, referenced by the transaction that executes it. */
  id: string;
  /** ISO 8601 timestamp after which this quote is no longer valid. Required by SEP-38 §POST /quote. */
  expiresAt: string;
}

export type Sep38Quote = Sep38IndicativePrice | Sep38FirmQuote;

export interface Sep38IndicativePriceRequest {
  quoteServer: string;
  sellAsset: Sep38Asset;
  buyAsset: Sep38Asset;
  /** Exactly one of `sellAmount`/`buyAmount` must be provided, per SEP-38. */
  sellAmount?: string;
  buyAmount?: string;
  context: "sep6" | "sep31";
  fetchImpl?: typeof fetch;
}

export interface Sep38FirmQuoteRequest {
  quoteServer: string;
  sellAsset: Sep38Asset;
  buyAsset: Sep38Asset;
  sellAmount?: string;
  buyAmount?: string;
  /** ISO 8601 timestamp the client would like the quote to be valid until. The server may return an earlier `expiresAt`. */
  expireAfter?: string;
  context: "sep6" | "sep31";
  /** SEP-10 JWT authorizing the request. Required by SEP-38 for `POST /quote`. */
  authToken: string;
  fetchImpl?: typeof fetch;
}

export class Sep38Error extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "Sep38Error";
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

async function sep38Fetch<T>(
  url: string,
  init: RequestInit & { authToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const { authToken, fetchImpl, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  const doFetch = fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, { ...rest, headers });
  } catch (err) {
    throw new Sep38Error(
      `SEP-38 request to "${url}" failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Sep38Error(
      `SEP-38 request failed (${response.status}): ${detail}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new Sep38Error(
      `SEP-38 response from "${url}" was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return body as T;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}

/**
 * Requests an **indicative** price via `GET /price`. Not binding — do not
 * pass the result to a transaction expecting a firm, executable quote.
 *
 * @throws {Sep38Error} on a non-2xx response, network failure, or malformed body.
 */
export async function fetchSep38IndicativePrice(
  request: Sep38IndicativePriceRequest,
): Promise<Sep38IndicativePrice> {
  if (!request.sellAmount && !request.buyAmount) {
    throw new Sep38Error(
      "fetchSep38IndicativePrice: exactly one of sellAmount or buyAmount is required.",
    );
  }

  const query = buildQuery({
    sell_asset: request.sellAsset,
    buy_asset: request.buyAsset,
    sell_amount: request.sellAmount,
    buy_amount: request.buyAmount,
    context: request.context,
  });
  const base = request.quoteServer.replace(/\/$/, "");

  interface RawPrice {
    price: string;
    sell_amount: string;
    buy_amount: string;
  }
  const raw = await sep38Fetch<RawPrice>(`${base}/price?${query}`, {
    fetchImpl: request.fetchImpl,
  });

  return {
    kind: "indicative",
    sellAsset: request.sellAsset,
    buyAsset: request.buyAsset,
    price: raw.price,
    sellAmount: raw.sell_amount,
    buyAmount: raw.buy_amount,
  };
}

/**
 * Requests a **firm**, binding quote via `POST /quote`. The returned quote
 * is executable (referenced by `id`) until `expiresAt`.
 *
 * @throws {Sep38Error} on a non-2xx response, network failure, or malformed body.
 */
export async function fetchSep38FirmQuote(
  request: Sep38FirmQuoteRequest,
): Promise<Sep38FirmQuote> {
  if (!request.sellAmount && !request.buyAmount) {
    throw new Sep38Error(
      "fetchSep38FirmQuote: exactly one of sellAmount or buyAmount is required.",
    );
  }

  const base = request.quoteServer.replace(/\/$/, "");

  interface RawQuote {
    id: string;
    expires_at: string;
    price: string;
    sell_asset: string;
    sell_amount: string;
    buy_asset: string;
    buy_amount: string;
  }
  const raw = await sep38Fetch<RawQuote>(`${base}/quote`, {
    method: "POST",
    authToken: request.authToken,
    fetchImpl: request.fetchImpl,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sell_asset: request.sellAsset,
      buy_asset: request.buyAsset,
      sell_amount: request.sellAmount,
      buy_amount: request.buyAmount,
      expire_after: request.expireAfter,
      context: request.context,
    }),
  });

  if (!raw.expires_at) {
    throw new Sep38Error(
      "fetchSep38FirmQuote: server response is missing required expires_at.",
    );
  }

  return {
    kind: "firm",
    id: raw.id,
    expiresAt: raw.expires_at,
    sellAsset: raw.sell_asset,
    buyAsset: raw.buy_asset,
    price: raw.price,
    sellAmount: raw.sell_amount,
    buyAmount: raw.buy_amount,
  };
}
